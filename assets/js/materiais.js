import { supabase } from './supabase.js';
import { listar, inserir, atualizar, excluir } from './db.js';
import { esc, el, toast, mostrarErro, carregando, formulario, abrirModal } from './ui.js';
import { getSessao } from './auth.js';

// Arquivos ficam no Supabase Storage, em <bucket>/<user_id>/<pasta>/<nome-seguro>.
// Em fontes_material, storage_path guarda "<bucket>/<caminho>", por exemplo "modelos/<uid>/modelo/arquivo.docx".
const BUCKET = { modelo: 'modelos', material_base: 'materiais' };
const PASTA = { modelo: 'modelo', material_base: 'material' };
const TIPOS_ACEITOS = '.pdf,.txt,.md,.docx,.pptx,.xlsx';
const INDEXAVEIS = /\.(pdf|txt|md)$/i;

const TIPO_ROTULO = {
  livro: 'Livro',
  curriculo_oficial: 'Currículo oficial',
  apostila: 'Apostila',
  artigo: 'Artigo',
  slides: 'Slides',
  outro: 'Outro'
};
const STATUS_ROTULO = { pendente: 'Não indexado', processando: 'Indexando...', indexado: 'Indexado', erro: 'Erro' };

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

async function chamarFuncao(nome, corpo) {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

// Indexa o material em blocos de páginas, mostrando o progresso.
export async function indexarCompleto(fonteId, aoProgresso = () => {}) {
  let pagina = 1;
  let trechos = 0;
  let total = 0;
  while (pagina) {
    const r = await chamarFuncao('indexar-material', { fonte_id: fonteId, pagina_inicio: pagina });
    total = r.total_paginas;
    trechos += r.trechos;
    aoProgresso(r.processadas_ate, total);
    pagina = r.proxima_pagina;
  }
  return { total, trechos };
}

// Seletor usado na geração. Nada é lido nem consultado sem o professor marcar.
export async function seletorMateriais({ disciplina = null } = {}) {
  const itens = await listar('fontes_material', {
    ordem: 'nome',
    ajuste: (q) => q.eq('categoria', 'material_base').eq('status', 'indexado')
  });
  const bloco = el('<div class="card" style="box-shadow:none;border:1px solid var(--borda);margin-bottom:16px"></div>');
  bloco.innerHTML = `
    <h3 style="margin-bottom:6px">Base para a IA</h3>
    <p class="small muted" style="margin-bottom:12px">Marque os materiais que a IA deve consultar. Materiais não marcados não são lidos e não gastam consulta.</p>
    ${itens.length ? `<div class="dia-lista" style="gap:8px">${itens.map((i) => {
      const sugerido = disciplina && (i.disciplinas || []).some((d) => d.toLowerCase() === disciplina.toLowerCase());
      return `<label class="dia-item" style="cursor:pointer">
        <span style="display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" value="${i.id}" ${sugerido ? 'checked' : ''} style="margin-top:4px;accent-color:var(--laranja)">
          <span>
            <strong>${esc(i.nome)}</strong>
            <span class="small muted" style="display:block">${esc(TIPO_ROTULO[i.tipo_material] || 'Sem tipo')} · ${esc(i.area_geral || 'sem área')}${i.area_especifica ? ' · ' + esc(i.area_especifica) : ''}${i.paginas ? ` · ${i.paginas} p.` : ''}</span>
            ${(i.disciplinas || []).length ? `<span style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${i.disciplinas.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</span>` : ''}
          </span>
        </span>
        ${sugerido ? '<span class="tag verde">sugerido</span>' : ''}
      </label>`;
    }).join('')}</div>` : '<div class="aviso azul">Nenhum material indexado. Envie e indexe em Materiais para a IA poder usar.</div>'}
    <label class="campo" style="margin-top:14px"><span>Observações para a IA</span>
      <textarea id="seletor-obs" placeholder="Ex.: dar ênfase em práticas no laboratório; usar exemplos em Python"></textarea>
    </label>`;
  return {
    el: bloco,
    ler: () => ({
      fonte_ids: [...bloco.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value),
      observacoes: bloco.querySelector('#seletor-obs').value.trim()
    })
  };
}

export async function telaMateriais(main) {
  const sessao = await getSessao();
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Materiais-base e modelos</h1>
        <p>Envie os materiais e confira a classificação. A IA só consulta o que você escolher na hora de gerar.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3>Enviar arquivos</h3>
      <div class="filtros" style="margin-bottom:0">
        <label class="campo"><span>Categoria</span>
          <select id="mat-categoria">
            <option value="material_base">Material-base (referência da IA)</option>
            <option value="modelo">Modelo de planejamento</option>
          </select>
        </label>
        <label class="campo" style="flex:1;min-width:260px"><span>Arquivos (PDF, TXT, MD, DOCX, PPTX, XLSX)</span>
          <input type="file" id="mat-arquivos" multiple accept="${TIPOS_ACEITOS}">
        </label>
        <button class="btn primary" id="mat-enviar" type="button">Enviar</button>
      </div>
      <p class="small muted" style="margin:10px 0 0">Materiais em PDF, TXT ou MD são indexados automaticamente após o envio. Modelos (DOCX) são só guardados.</p>
    </div>

    <div class="card">
      <h3>Arquivos</h3>
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
    const limite = categoria === 'modelo' ? 50 : 200;
    if (arq.size > limite * 1024 * 1024) {
      toast(`${arq.name} passa de ${limite} MB e não pode ser enviado.`, 'erro');
      continue;
    }
    const caminho = `${userId}/${PASTA[categoria]}/${nomeSeguro(arq.name)}`;
    toast(`Enviando ${arq.name}...`, '');
    const { error } = await supabase.storage.from(bucket).upload(caminho, arq, {
      contentType: arq.type || 'application/octet-stream',
      upsert: false
    });
    if (error) throw new Error(`Não foi possível enviar ${arq.name}: ${error.message}`);
    const [novo] = await inserir('fontes_material', {
      nome: arq.name,
      origem: 'storage',
      categoria,
      storage_path: `${bucket}/${caminho}`,
      mime_type: arq.type || null,
      tamanho_bytes: arq.size,
      status: 'pendente'
    });
    enviados++;
    if (categoria === 'material_base' && INDEXAVEIS.test(arq.name)) {
      await indexarComAviso(arq.name, novo.id);
    }
    await renderLista(main);
  }
  main.querySelector('#mat-arquivos').value = '';
  toast(`${enviados} arquivo(s) enviado(s).`, 'ok');
  renderLista(main);
}

async function indexarComAviso(nome, fonteId) {
  try {
    toast(`Indexando ${nome}...`, '');
    const r = await indexarCompleto(fonteId, (feito, total) => toast(`Indexando ${nome}: ${feito} de ${total} páginas`, ''));
    toast(`${nome} indexado (${r.total} páginas, ${r.trechos} trechos).`, 'ok');
  } catch (err) {
    mostrarErro(err);
  }
}

function formularioClassificacao(item) {
  return formulario([
    { k: 'tipo_material', label: 'Tipo', type: 'select', opcoes: Object.entries(TIPO_ROTULO), vazio: 'Não definido' },
    { k: 'area_geral', label: 'Área geral', type: 'text', placeholder: 'Ex.: Computação, Educação' },
    { k: 'area_especifica', label: 'Área específica', type: 'text', placeholder: 'Ex.: Programação em Python' },
    { k: 'disciplinas', label: 'Disciplinas que este material atende', type: 'lista', largo: true, ajuda: 'Uma por linha ou separadas por vírgula.' },
    { k: 'resumo', label: 'Resumo', type: 'textarea', largo: true }
  ], {
    tipo_material: item.tipo_material,
    area_geral: item.area_geral,
    area_especifica: item.area_especifica,
    disciplinas: item.disciplinas || [],
    resumo: item.resumo
  });
}

function editarClassificacao(item, recarregar) {
  const f = formularioClassificacao(item);
  const sugestao = item.sugestao;
  const conteudo = el('<div></div>');
  if (sugestao) {
    conteudo.appendChild(el(`<div class="aviso azul" style="margin-bottom:14px">
      <strong>Sugestão da IA:</strong> ${esc(TIPO_ROTULO[sugestao.tipo_material] || sugestao.tipo_material || '—')} · ${esc(sugestao.area_geral || '—')} · ${esc(sugestao.area_especifica || '—')}
      ${(sugestao.disciplinas || []).length ? `<br><span class="small">Disciplinas: ${esc(sugestao.disciplinas.join(', '))}</span>` : ''}
      <br><span class="small">Use o botão "Aplicar sugestão" para preencher, depois ajuste e salve.</span>
    </div>`));
  }
  conteudo.appendChild(f.el);

  const aplicar = (fechar) => {
    const campos = f.el;
    if (!sugestao) return;
    const preencher = (nome, valor) => {
      const c = campos.querySelector(`[name="${nome}"]`);
      if (c && valor !== undefined && valor !== null) c.value = Array.isArray(valor) ? valor.join('\n') : valor;
    };
    preencher('tipo_material', sugestao.tipo_material);
    preencher('area_geral', sugestao.area_geral);
    preencher('area_especifica', sugestao.area_especifica);
    preencher('disciplinas', sugestao.disciplinas);
    preencher('resumo', sugestao.resumo);
  };

  abrirModal({
    titulo: item.nome,
    conteudo,
    submitLabel: 'Salvar classificação',
    acoesExtras: sugestao ? [{ label: 'Aplicar sugestão da IA', classe: 'azul', onClick: (fechar) => aplicar(fechar) }] : [],
    grande: true,
    onSubmit: async (fechar) => {
      const v = f.ler();
      await atualizar('fontes_material', item.id, {
        tipo_material: v.tipo_material,
        area_geral: v.area_geral,
        area_especifica: v.area_especifica,
        disciplinas: v.disciplinas || [],
        resumo: v.resumo
      });
      fechar();
      toast('Classificação salva.', 'ok');
      recarregar();
    }
  });
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
        <thead><tr><th>Arquivo</th><th>Tipo</th><th>Área geral</th><th>Área específica</th><th>Disciplinas</th><th>Páginas</th><th>Situação</th><th></th></tr></thead>
        <tbody>${itens.map((i) => `
          <tr>
            <td><strong>${esc(i.nome)}</strong><div class="small muted">${tamanho(i.tamanho_bytes)}</div></td>
            <td>${i.categoria === 'modelo' ? '<span class="tag laranja">modelo</span>' : esc(TIPO_ROTULO[i.tipo_material] || '—')}</td>
            <td>${esc(i.area_geral || '—')}</td>
            <td>${esc(i.area_especifica || '—')}</td>
            <td>${(i.disciplinas || []).map((d) => `<span class="tag">${esc(d)}</span>`).join(' ') || '—'}</td>
            <td>${i.paginas ?? '—'}</td>
            <td><span class="tag ${i.status === 'indexado' ? 'verde' : i.status === 'erro' ? 'perigo' : ''}" title="${esc(i.erro_indexacao || '')}">${esc(STATUS_ROTULO[i.status] || i.status)}</span></td>
            <td class="acoes-linha">
              ${i.categoria === 'material_base' && i.status !== 'indexado' && INDEXAVEIS.test(i.nome) ? `<button class="btn pequeno azul" data-indexar="${i.id}" type="button">Indexar</button>` : ''}
              ${i.categoria === 'material_base' ? `<button class="btn pequeno" data-editar="${i.id}" type="button">Classificar</button>` : ''}
              <button class="btn pequeno" data-baixar="${i.id}" type="button">Abrir</button>
              <button class="btn pequeno perigo" data-apagar="${i.id}" type="button">Excluir</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;

    area.onclick = async (e) => {
      const b = (sel) => e.target.closest(sel);
      const indexar = b('[data-indexar]');
      const editar = b('[data-editar]');
      const baixar = b('[data-baixar]');
      const apagar = b('[data-apagar]');
      if (indexar) {
        const item = itens.find((x) => x.id === indexar.dataset.indexar);
        await indexarComAviso(item.nome, item.id);
        renderLista(main);
      }
      if (editar) {
        const item = itens.find((x) => x.id === editar.dataset.editar);
        editarClassificacao(item, () => renderLista(main));
      }
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
        if (!window.confirm(`Excluir "${item.nome}"? O arquivo, os trechos indexados e a classificação saem do sistema.`)) return;
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
