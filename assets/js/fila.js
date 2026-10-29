import { supabase } from './supabase.js';
import { listar } from './db.js';
import { esc, toast } from './ui.js';

// Fila de indexação de materiais. Roda enquanto o site estiver aberto, em qualquer menu.
// Se a aba for fechada, o progresso fica salvo (paginas_indexadas) e a fila retoma no próximo login.
const estado = { fila: [], ativo: null, rodando: false };
const TENTATIVAS = 3;

async function mensagemErro(error) {
  let msg = error.message;
  try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem JSON */ }
  return msg;
}

function atualizarPainel() {
  const barra = document.getElementById('fila-status');
  if (barra) {
    const a = estado.ativo;
    const pendentes = estado.fila.length;
    if (!a && !pendentes) {
      barra.hidden = true;
      barra.innerHTML = '';
    } else {
      barra.hidden = false;
      barra.innerHTML = a
        ? `<span class="giro"></span><span>Indexando <strong>${esc(a.nome)}</strong>: ${a.feito} de ${a.total ?? '?'} páginas${pendentes ? ` · ${pendentes} na fila` : ''}</span>`
        : `<span>${pendentes} material(is) na fila</span>`;
    }
  }
  window.dispatchEvent(new CustomEvent('fila-atualizada'));
}

async function chamar(corpo) {
  let ultimo = 'Erro desconhecido.';
  for (let t = 1; t <= TENTATIVAS; t++) {
    const { data, error } = await supabase.functions.invoke('indexar-material', { body: corpo });
    if (!error && !data?.erro) return data;
    ultimo = error ? await mensagemErro(error) : data.erro;
    if (t < TENTATIVAS) await new Promise((r) => setTimeout(r, 3000 * t));
  }
  throw new Error(ultimo);
}

async function indexar(item) {
  const [fonte] = await listar('fontes_material', { ordem: null, ajuste: (q) => q.eq('id', item.id) });
  if (!fonte) return;
  const recomecar = !fonte.paginas_indexadas || fonte.status === 'erro' || fonte.status === 'pendente';
  let pagina = recomecar ? 1 : fonte.paginas_indexadas + 1;

  estado.ativo = { id: item.id, nome: item.nome, feito: recomecar ? 0 : fonte.paginas_indexadas, total: fonte.paginas };
  atualizarPainel();

  while (pagina) {
    const r = await chamar({ fonte_id: item.id, pagina_inicio: pagina });
    estado.ativo.feito = r.processadas_ate;
    estado.ativo.total = r.total_paginas;
    atualizarPainel();
    pagina = r.proxima_pagina;
  }
  toast(`${item.nome} indexado.`, 'ok');
}

async function processar() {
  if (estado.rodando) return;
  estado.rodando = true;
  while (estado.fila.length) {
    const item = estado.fila.shift();
    try {
      await indexar(item);
    } catch (err) {
      toast(`${item.nome}: ${err.message}`, 'erro');
    } finally {
      estado.ativo = null;
      atualizarPainel();
    }
  }
  estado.rodando = false;
}

export function enfileirar(item) {
  if (estado.ativo?.id === item.id || estado.fila.some((f) => f.id === item.id)) return;
  estado.fila.push(item);
  atualizarPainel();
  processar();
}

// Retoma materiais que ficaram no meio (aba fechada ou erro de rede).
export async function retomarPendentes() {
  const pendentes = await listar('fontes_material', { ordem: 'nome', ajuste: (q) => q.eq('status', 'processando') });
  pendentes.forEach((p) => enfileirar({ id: p.id, nome: p.nome }));
}
