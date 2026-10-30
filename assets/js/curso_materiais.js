import { supabase } from './supabase.js';
import { listar, inserir, excluir } from './db.js';
import { esc, el, toast, mostrarErro, abrirModal, fecharModal } from './ui.js';
import { getSessao } from './auth.js';
import { enfileirar } from './fila.js';

// Materiais de um curso técnico. O material marcado como "orientador" (ex.: matriz de conteúdos)
// entra automaticamente na geração dos planos das turmas do curso.
const INDEXAVEIS = /\.(pdf|txt|md)$/i;
const TIPOS_ACEITOS = '.pdf,.txt,.md,.docx';

function nomeSeguro(nome) {
  const semAcento = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${Date.now()}-${semAcento.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-')}`;
}

function separarCaminho(storagePath) {
  const i = storagePath.indexOf('/');
  return { bucket: storagePath.slice(0, i), caminho: storagePath.slice(i + 1) };
}

function conteudoModal(curso) {
  return el(`<div>
    <div class="aviso azul" style="margin-bottom:14px">
      <strong>Materiais orientadores</strong>: ao marcar como orientador, o conteúdo entra inteiro na geração dos planos das turmas deste curso.
      Use para a matriz de conteúdos de cada disciplina. Materiais comuns (de referência) continuam sendo escolhidos na hora de gerar.
    </div>
    <div class="card" style="box-shadow:none;border:1px solid var(--borda);margin-bottom:16px">
      <div class="filtros" style="margin-bottom:0">
        <label class="campo" style="flex:1;min-width:240px"><span>Arquivo (PDF, TXT, MD ou DOCX)</span>
          <input type="file" id="cm-arquivo" accept="${TIPOS_ACEITOS}">
        </label>
        <label class="campo linha"><input type="checkbox" id="cm-orientador" checked><span>Orientador (entra em todos os planos do curso)</span></label>
        <button class="btn primary" id="cm-enviar" type="button">Enviar</button>
      </div>
    </div>
    <h3 style="margin-bottom:10px">Arquivos de ${esc(curso.nome)}</h3>
    <div id="cm-lista"></div>
  </div>`);
}

async function renderLista(curso, conteudo) {
  const area = conteudo.querySelector('#cm-lista');
  try {
    const itens = await listar('fontes_material', { ordem: 'nome', ajuste: (q) => q.eq('curso_id', curso.id) });
    if (!itens.length) {
      area.innerHTML = '<div class="vazio">Nenhum material deste curso ainda.</div>';
      return;
    }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Arquivo</th><th>Papel</th><th>Situação</th><th></th></tr></thead>
        <tbody>${itens.map((i) => `
          <tr>
            <td><strong>${esc(i.nome)}</strong></td>
            <td>${i.orientador ? '<span class="tag laranja">orientador</span>' : '<span class="tag">referência</span>'}</td>
            <td><span class="tag ${i.status === 'indexado' ? 'verde' : i.status === 'erro' ? 'perigo' : ''}" title="${esc(i.erro_indexacao || '')}">${esc(i.status === 'processando' ? `indexando ${i.paginas_indexadas ?? 0}/${i.paginas ?? '?'}` : i.status)}</span></td>
            <td class="acoes-linha">
              ${i.status !== 'indexado' && INDEXAVEIS.test(i.nome) ? `<button class="btn pequeno azul" data-cm-indexar="${i.id}" type="button">Indexar</button>` : ''}
              <button class="btn pequeno" data-cm-orientador="${i.id}" data-valor="${i.orientador ? '0' : '1'}" type="button">${i.orientador ? 'Tirar de orientador' : 'Marcar como orientador'}</button>
              <button class="btn pequeno perigo" data-cm-excluir="${i.id}" type="button">Excluir</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;
    area.onclick = (e) => acoesLista(e, curso, conteudo, itens);
  } catch (err) {
    area.innerHTML = `<div class="aviso">${esc(err.message)}</div>`;
  }
}

async function acoesLista(e, curso, conteudo, itens) {
  const indexar = e.target.closest('[data-cm-indexar]');
  const orient = e.target.closest('[data-cm-orientador]');
  const excl = e.target.closest('[data-cm-excluir]');
  try {
    if (indexar) {
      const item = itens.find((x) => x.id === indexar.dataset.cmIndexar);
      enfileirar({ id: item.id, nome: item.nome });
      toast(`${item.nome} entrou na fila de indexação.`, 'ok');
    }
    if (orient) {
      await supabase.from('fontes_material').update({ orientador: orient.dataset.valor === '1' }).eq('id', orient.dataset.cmOrientador);
      toast('Papel do material atualizado.', 'ok');
      renderLista(curso, conteudo);
    }
    if (excl) {
      const item = itens.find((x) => x.id === excl.dataset.cmExcluir);
      if (!window.confirm(`Excluir "${item.nome}"? O arquivo e os trechos indexados saem do sistema.`)) return;
      const { bucket, caminho } = separarCaminho(item.storage_path);
      const { error } = await supabase.storage.from(bucket).remove([caminho]);
      if (error) throw error;
      await excluir('fontes_material', item.id);
      toast('Material excluído.', 'ok');
      renderLista(curso, conteudo);
    }
  } catch (err) { mostrarErro(err); }
}

export function abrirMateriaisCurso(curso) {
  const conteudo = conteudoModal(curso);
  abrirModal({ titulo: `Materiais do curso · ${curso.nome}`, conteudo, grande: true });
  renderLista(curso, conteudo);

  conteudo.querySelector('#cm-enviar').onclick = async () => {
    try {
      const sessao = await getSessao();
      const userId = sessao?.user?.id;
      if (!userId) throw new Error('Sessão expirada. Entre novamente.');
      const arq = conteudo.querySelector('#cm-arquivo').files[0];
      if (!arq) return toast('Escolha um arquivo.', 'erro');
      const limite = 200;
      if (arq.size > limite * 1024 * 1024) return toast(`${arq.name} passa de ${limite} MB.`, 'erro');

      const orientador = conteudo.querySelector('#cm-orientador').checked;
      const caminho = `${userId}/curso/${curso.id}/${nomeSeguro(arq.name)}`;
      toast(`Enviando ${arq.name}...`, '');
      const { error } = await supabase.storage.from('materiais').upload(caminho, arq, {
        contentType: arq.type || 'application/octet-stream',
        upsert: false
      });
      if (error) throw new Error(`Não foi possível enviar ${arq.name}: ${error.message}`);

      const [novo] = await inserir('fontes_material', {
        nome: arq.name,
        origem: 'storage',
        categoria: 'material_base',
        curso_id: curso.id,
        orientador,
        storage_path: `materiais/${caminho}`,
        mime_type: arq.type || null,
        tamanho_bytes: arq.size,
        status: 'pendente'
      });
      if (INDEXAVEIS.test(arq.name)) enfileirar({ id: novo.id, nome: arq.name });
      conteudo.querySelector('#cm-arquivo').value = '';
      toast(`${arq.name} enviado.`, 'ok');
      renderLista(curso, conteudo);
    } catch (err) { mostrarErro(err); }
  };
}
