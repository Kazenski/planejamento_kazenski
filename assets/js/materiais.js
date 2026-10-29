import { supabase } from './supabase.js';
import { listar, inserir, excluir } from './db.js';
import { esc, toast, mostrarErro, carregando } from './ui.js';
import { getSessao } from './auth.js';

// Arquivos ficam no Supabase Storage, em <bucket>/<user_id>/<pasta>/<nome-seguro>.
// Em fontes_material, storage_path guarda "<bucket>/<caminho>", por exemplo "modelos/<uid>/modelo/arquivo.docx".
const BUCKET = { modelo: 'modelos', material_base: 'materiais' };
const PASTA = { modelo: 'modelo', material_base: 'material' };
const CATEGORIA_ROTULO = { modelo: 'Modelo de planejamento', material_base: 'Material-base' };
const TIPOS_ACEITOS = '.pdf,.docx,.pptx,.txt,.md,.xlsx';

function nomeSeguro(nome) {
  const semAcento = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${Date.now()}-${semAcento.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-')}`;
}

function separarCaminho(storagePath) {
  const i = storagePath.indexOf('/');
  return { bucket: storagePath.slice(0, i), caminho: storagePath.slice(i + 1) };
}

function tamanho(bytes) {
  if (!bytes) return '—';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export async function telaMateriais(main) {
  const sessao = await getSessao();
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Materiais-base e modelos</h1>
        <p>Os arquivos ficam guardados no sistema, na sua conta. Os modelos são usados para adaptar o formato do planejamento. Os materiais-base são a referência da IA.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3>Enviar arquivo</h3>
      <div class="filtros" style="margin-bottom:0">
        <label class="campo"><span>Categoria</span>
          <select id="mat-categoria">
            <option value="material_base">Material-base (referência da IA)</option>
            <option value="modelo">Modelo de planejamento</option>
          </select>
        </label>
        <label class="campo" style="flex:1;min-width:260px"><span>Arquivos (PDF, DOCX, PPTX, TXT, MD, XLSX)</span>
          <input type="file" id="mat-arquivos" multiple accept="${TIPOS_ACEITOS}">
        </label>
        <button class="btn primary" id="mat-enviar" type="button">Enviar</button>
      </div>
      <p class="small muted" style="margin:10px 0 0">Limite de 200 MB por arquivo para materiais e 50 MB para modelos.</p>
    </div>

    <div class="card">
      <h3>Arquivos registrados</h3>
      <div id="mat-lista">${carregando()}</div>
    </div>`;

  main.querySelector('#mat-enviar').onclick = () => enviar(main, sessao).catch(mostrarErro);
  renderLista(main);
}

async function enviar(main, sessao) {
  const userId = sessao?.user?.id;
  if (!userId) throw new Error('Sessão expirada. Entre novamente.');
  const categoria = main.querySelector('#mat-categoria').value;
  const arquivos = [...main.querySelector('#mat-arquivos').files];
  if (!arquivos.length) return toast('Escolha ao menos um arquivo.', 'erro');

  const bucket = BUCKET[categoria];
  let enviados = 0;
  for (const arq of arquivos) {
    const caminho = `${userId}/${PASTA[categoria]}/${nomeSeguro(arq.name)}`;
    toast(`Enviando ${arq.name}...`, '');
    const { error } = await supabase.storage.from(bucket).upload(caminho, arq, {
      contentType: arq.type || 'application/octet-stream',
      upsert: false
    });
    if (error) throw new Error(`Não foi possível enviar ${arq.name}: ${error.message}`);
    await inserir('fontes_material', {
      nome: arq.name,
      origem: 'storage',
      categoria,
      storage_path: `${bucket}/${caminho}`,
      mime_type: arq.type || null,
      tamanho_bytes: arq.size,
      status: 'pendente'
    });
    enviados++;
  }
  main.querySelector('#mat-arquivos').value = '';
  toast(`${enviados} arquivo(s) enviado(s).`, 'ok');
  renderLista(main);
}

async function renderLista(main) {
  const area = main.querySelector('#mat-lista');
  try {
    const itens = await listar('fontes_material', { ordem: 'nome' });
    if (!itens.length) {
      area.innerHTML = '<div class="vazio">Nenhum arquivo enviado ainda.</div>';
      return;
    }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Arquivo</th><th>Categoria</th><th>Tamanho</th><th>Indexação</th><th></th></tr></thead>
        <tbody>${itens.map((i) => `
          <tr>
            <td><strong>${esc(i.nome)}</strong></td>
            <td>${i.categoria === 'modelo' ? '<span class="tag laranja">modelo</span>' : '<span class="tag azul">material-base</span>'}</td>
            <td class="small muted">${tamanho(i.tamanho_bytes)}</td>
            <td><span class="tag">${esc(i.status)}</span></td>
            <td class="acoes-linha">
              <button class="btn pequeno" data-baixar="${i.id}" type="button">Abrir</button>
              <button class="btn pequeno perigo" data-apagar="${i.id}" type="button">Excluir</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>
      <p class="small muted" style="margin-top:10px">A indexação do conteúdo para a IA é a próxima etapa. Hoje o arquivo fica guardado e disponível para abrir.</p>`;

    area.onclick = async (e) => {
      const baixar = e.target.closest('[data-baixar]');
      const apagar = e.target.closest('[data-apagar]');
      if (baixar) {
        const item = itens.find((x) => x.id === baixar.dataset.baixar);
        try {
          const { bucket, caminho } = separarCaminho(item.storage_path);
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 300);
          if (error) throw error;
          window.open(data.signedUrl, '_blank', 'noopener');
        } catch (err) { mostrarErro(err); }
      }
      if (apagar) {
        const item = itens.find((x) => x.id === apagar.dataset.apagar);
        if (!window.confirm(`Excluir "${item.nome}"? O arquivo sai do sistema.`)) return;
        try {
          const { bucket, caminho } = separarCaminho(item.storage_path);
          const { error } = await supabase.storage.from(bucket).remove([caminho]);
          if (error) throw error;
          await excluir('fontes_material', item.id);
          toast('Arquivo excluído.', 'ok');
          renderLista(main);
        } catch (err) { mostrarErro(err); }
      }
    };
  } catch (err) {
    area.innerHTML = `<div class="aviso">${esc(err.message)}</div>`;
  }
}
