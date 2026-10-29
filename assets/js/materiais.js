import { listar, inserirVarios, excluir, getConfig, setConfig } from './db.js';
import { esc, toast, mostrarErro, carregando } from './ui.js';
import { conectarDrive, getSessao } from './auth.js';
import { DRIVE_SCOPE } from './config.js';

const API_DRIVE = 'https://www.googleapis.com/drive/v3/files';

// Aceita o link completo da pasta do Drive ou só o ID.
export function extrairIdPasta(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const m = t.match(/folders\/([A-Za-z0-9_-]+)/) || t.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

// Confere, no próprio Google, se o token atual tem a permissão de leitura do Drive.
async function statusDrive(sessao) {
  const token = sessao?.provider_token;
  if (!token) return { ok: false, motivo: 'sem_token' };
  try {
    const r = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!r.ok) return { ok: false, motivo: 'token_expirado' };
    const info = await r.json();
    const escopos = String(info.scope || '').split(' ');
    return { ok: escopos.includes(DRIVE_SCOPE), motivo: escopos.includes(DRIVE_SCOPE) ? '' : 'sem_escopo', escopos };
  } catch {
    // Se a verificação não puder ser feita no navegador, deixa a própria chamada ao Drive decidir.
    return { ok: true, motivo: '' };
  }
}

async function erroDrive(resp) {
  const corpo = await resp.json().catch(() => ({}));
  const reason = corpo.error?.errors?.[0]?.reason || '';
  const detalhe = corpo.error?.message || `HTTP ${resp.status}`;
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(detalhe)) {
    return 'A Google Drive API não está ativada no projeto do Google Cloud. Ative em APIs e serviços > Biblioteca > Google Drive API, no projeto kazenski.';
  }
  if (resp.status === 401) {
    return 'A sessão do Google expirou. Clique em "Reconectar Drive".';
  }
  if (resp.status === 403 && /insufficient|scope/i.test(reason + detalhe)) {
    return 'A permissão de leitura do Drive não foi concedida. Clique em "Reconectar Drive" e marque a permissão de leitura do Drive na tela do Google.';
  }
  if (resp.status === 403) {
    return 'Sem acesso a esta pasta. Confirme que ela está como "Qualquer pessoa com o link: leitor".';
  }
  if (resp.status === 404) {
    return 'Pasta não encontrada. Confira o link ou o ID.';
  }
  return `O Drive respondeu com erro. Detalhe: ${detalhe}`;
}

async function listarPastaDrive(token, pastaId) {
  const q = `'${pastaId}' in parents and trashed = false`;
  const url = `${API_DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,size)')}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(await erroDrive(resp));
  const json = await resp.json();
  return json.files || [];
}

export async function telaMateriais(main) {
  const sessao = await getSessao();
  const status = await statusDrive(sessao);
  const pastaMat = await getConfig('drive_pasta_materiais', null);
  const pastaMod = await getConfig('drive_pasta_modelos', null);

  const avisoConexao = {
    sem_token: 'O Drive ainda não foi conectado. Clique em "Conectar Drive" e aceite a permissão de leitura.',
    token_expirado: 'A conexão com o Google expirou. Clique em "Reconectar Drive".',
    sem_escopo: 'Você entrou no site, mas a permissão de leitura do Drive não foi concedida. Clique em "Reconectar Drive" e marque a permissão.'
  };

  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Materiais-base e modelos</h1>
        <p>Os arquivos ficam no Google Drive. Aqui você registra quais entram como base da IA e quais são modelos de planejamento do colégio.</p>
      </div>
      <div class="acoes">
        ${status.ok
          ? '<span class="tag verde">Drive conectado com permissão de leitura</span> <button class="btn pequeno" id="btn-drive" type="button">Reconectar Drive</button>'
          : '<button class="btn azul" id="btn-drive" type="button">Conectar Drive</button>'}
      </div>
    </div>

    ${status.ok ? '' : `<div class="aviso azul" style="margin-bottom:16px">
      ${esc(avisoConexao[status.motivo] || avisoConexao.sem_token)}
      ${status.escopos ? `<br><span class="small">Permissões que o Google devolveu para este login: <strong>${esc(status.escopos.filter(Boolean).map((e) => e.replace('https://www.googleapis.com/auth/', '').replace('https://www.googleapis.com/', '')).join(', ') || 'nenhuma')}</strong>. Para conferir no Google: myaccount.google.com/permissions</span>` : ''}
    </div>`}

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-bottom:20px">
      ${blocoPasta('materiais', 'Pasta de materiais-base', 'Livros, currículos e documentos de referência.', pastaMat)}
      ${blocoPasta('modelos', 'Pasta de modelos de planejamento', 'Modelos que os colégios usam, para adaptar o formato.', pastaMod)}
    </div>

    <div class="card">
      <h3>Arquivos registrados</h3>
      <div id="registrados">${carregando()}</div>
    </div>`;

  main.querySelector('#btn-drive')?.addEventListener('click', () => conectarDrive().catch(mostrarErro));

  main.querySelectorAll('[data-salvar-pasta]').forEach((b) => b.addEventListener('click', async () => {
    const tipo = b.dataset.salvarPasta;
    const input = main.querySelector(`#pasta-${tipo}`);
    const id = extrairIdPasta(input.value);
    if (!id) return toast('Cole o link da pasta ou o ID dela.', 'erro');
    try {
      await setConfig(`drive_pasta_${tipo}`, id);
      toast('Pasta salva.', 'ok');
      telaMateriais(main);
    } catch (err) { mostrarErro(err); }
  }));

  main.querySelectorAll('[data-listar]').forEach((b) => b.addEventListener('click', () => listarPasta(main, b.dataset.listar, sessao)));

  renderRegistrados(main);
}

function blocoPasta(tipo, titulo, ajuda, idAtual) {
  return `
    <div class="card">
      <h3>${titulo}</h3>
      <p class="small muted">${ajuda}</p>
      <label class="campo"><span>Link ou ID da pasta do Drive</span>
        <input id="pasta-${tipo}" value="${esc(idAtual ? `https://drive.google.com/drive/folders/${idAtual}` : '')}" placeholder="https://drive.google.com/drive/folders/...">
      </label>
      <div class="acoes" style="margin-top:10px">
        <button class="btn" data-salvar-pasta="${tipo}" type="button">Salvar pasta</button>
        <button class="btn primary" data-listar="${tipo}" type="button" ${idAtual ? '' : 'disabled'}>Listar arquivos</button>
      </div>
      <div id="lista-${tipo}" style="margin-top:14px"></div>
    </div>`;
}

async function listarPasta(main, tipo, sessao) {
  const area = main.querySelector(`#lista-${tipo}`);
  const pastaId = await getConfig(`drive_pasta_${tipo}`, null);
  if (!sessao?.provider_token) return toast('Conecte o Drive primeiro.', 'erro');
  if (!pastaId) return toast('Salve a pasta antes de listar.', 'erro');
  area.innerHTML = carregando('Lendo a pasta no Drive...');
  try {
    const arquivos = await listarPastaDrive(sessao.provider_token, pastaId);
    const registrados = await listar('fontes_material', { ordem: 'nome', ajuste: (q) => q.eq('categoria', tipo === 'materiais' ? 'material_base' : 'modelo') });
    const ids = new Set(registrados.map((r) => r.drive_file_id));
    if (!arquivos.length) { area.innerHTML = '<div class="vazio">A pasta está vazia ou não foi compartilhada com você.</div>'; return; }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Arquivo</th><th>Tipo</th><th></th></tr></thead>
        <tbody>${arquivos.map((a) => `
          <tr>
            <td>${esc(a.name)}</td>
            <td class="small muted">${esc(a.mimeType.split('/').pop())}</td>
            <td class="acoes-linha">${ids.has(a.id) ? '<span class="tag verde">registrado</span>' : `<button class="btn pequeno" data-reg='${esc(JSON.stringify({ id: a.id, nome: a.name, mime: a.mimeType }))}' data-cat="${tipo === 'materiais' ? 'material_base' : 'modelo'}" type="button">Registrar</button>`}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
    area.onclick = async (e) => {
      const b = e.target.closest('[data-reg]');
      if (!b) return;
      const a = JSON.parse(b.dataset.reg);
      try {
        await inserirVarios('fontes_material', [{ nome: a.nome, drive_file_id: a.id, mime_type: a.mime, categoria: b.dataset.cat, origem: 'drive', status: 'pendente' }]);
        toast('Arquivo registrado.', 'ok');
        renderRegistrados(main);
        listarPasta(main, tipo, sessao);
      } catch (err) { mostrarErro(err); }
    };
  } catch (err) {
    area.innerHTML = `
      <div class="aviso">${esc(err.message)}</div>
      <div class="acoes" style="margin-top:10px"><button class="btn pequeno azul" data-reconectar="1" type="button">Reconectar Drive</button></div>`;
    area.querySelector('[data-reconectar]').onclick = () => conectarDrive().catch(mostrarErro);
  }
}

async function renderRegistrados(main) {
  const area = main.querySelector('#registrados');
  try {
    const itens = await listar('fontes_material', { ordem: 'nome' });
    if (!itens.length) { area.innerHTML = '<div class="vazio">Nenhum arquivo registrado ainda.</div>'; return; }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Arquivo</th><th>Categoria</th><th>Indexação</th><th></th></tr></thead>
        <tbody>${itens.map((i) => `
          <tr>
            <td>${esc(i.nome)}</td>
            <td>${i.categoria === 'modelo' ? '<span class="tag laranja">modelo</span>' : '<span class="tag azul">material-base</span>'}</td>
            <td><span class="tag">${esc(i.status)}</span></td>
            <td class="acoes-linha"><button class="btn pequeno perigo" data-apagar="${i.id}" type="button">Remover</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      <p class="small muted" style="margin-top:10px">Indexação: o conteúdo dos arquivos entra na geração da IA na próxima etapa. Hoje o registro só guarda a referência.</p>`;
    area.onclick = async (e) => {
      const b = e.target.closest('[data-apagar]');
      if (!b) return;
      if (!window.confirm('Remover este arquivo da lista? O arquivo no Drive não é apagado.')) return;
      try {
        await excluir('fontes_material', b.dataset.apagar);
        renderRegistrados(main);
      } catch (err) { mostrarErro(err); }
    };
  } catch (err) {
    area.innerHTML = `<div class="aviso">${esc(err.message)}</div>`;
  }
}
