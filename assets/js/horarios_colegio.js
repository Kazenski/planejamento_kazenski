import { supabase } from './supabase.js';
import { listar, inserirVarios } from './db.js';
import { esc, el, abrirModal, toast, mostrarErro } from './ui.js';

// Grade padrão do sistema (usada por colégios sem grade cadastrada): 6 aulas, recreio após a 3ª.
export const GRADE_PADRAO = [
  { ordem: 1, tipo: 'aula' },
  { ordem: 2, tipo: 'aula' },
  { ordem: 3, tipo: 'aula' },
  { ordem: 4, tipo: 'intervalo', rotulo: 'Recreio' },
  { ordem: 5, tipo: 'aula' },
  { ordem: 6, tipo: 'aula' },
  { ordem: 7, tipo: 'aula' }
];

const MATUTINO = GRADE_PADRAO.map((l) => ({ ...l, inicio: null, fim: null }));

function linhaHtml(l) {
  return `
    <div class="grade-linha" data-ordem="${l.ordem}">
      <span class="grade-num">${l.ordem}º</span>
      <label class="campo linha"><input type="checkbox" data-nao-aula ${l.tipo === 'intervalo' ? 'checked' : ''}><span>Não é aula</span></label>
      <label class="campo"><span>Rótulo</span><input data-rotulo value="${esc(l.rotulo || '')}" placeholder="Ex.: Recreio"></label>
      <label class="campo"><span>Início</span><input type="time" data-inicio value="${esc(l.inicio ? String(l.inicio).slice(0, 5) : '')}"></label>
      <label class="campo"><span>Fim</span><input type="time" data-fim value="${esc(l.fim ? String(l.fim).slice(0, 5) : '')}"></label>
      <button type="button" class="btn pequeno perigo" data-remover>Remover</button>
    </div>`;
}

// Lê o que está na tela, para não perder edições ao adicionar ou remover linhas.
function lerLinhas(conteudo) {
  return [...conteudo.querySelectorAll('.grade-linha')].map((r, i) => ({
    ordem: i + 1,
    tipo: r.querySelector('[data-nao-aula]').checked ? 'intervalo' : 'aula',
    rotulo: r.querySelector('[data-rotulo]').value.trim() || null,
    inicio: r.querySelector('[data-inicio]').value || null,
    fim: r.querySelector('[data-fim]').value || null
  }));
}

function renderLinhas(conteudo, linhas) {
  const area = conteudo.querySelector('#grade-linhas');
  area.innerHTML = linhas.map(linhaHtml).join('') || '<p class="muted">Nenhum período. Adicione ou use o padrão matutino.</p>';
  area.querySelectorAll('.grade-linha').forEach((r, i) => {
    r.querySelector('[data-nao-aula]').onchange = () => { /* ao salvar, o tipo é lido da tela */ };
    r.querySelector('[data-remover]').onclick = () => {
      const atuais = lerLinhas(conteudo);
      atuais.splice(i, 1);
      renderLinhas(conteudo, atuais.map((l, k) => ({ ...l, ordem: k + 1 })));
    };
  });
  const aulas = linhas.filter((l) => l.tipo === 'aula').length;
  conteudo.querySelector('#grade-resumo').textContent = `${linhas.length} período(s): ${aulas} aula(s) e ${linhas.length - aulas} intervalo(s).`;
}

// Ao salvar uma grade nova, aulas posicionadas em períodos que deixaram de ser aula voltam para "sem dia".
async function reajustarAulasPosicionadas(colegioId, linhas) {
  const aulas = new Set(linhas.filter((l) => l.tipo === 'aula').map((l) => l.ordem));
  const posicionadas = await listar('horario_aulas', {
    select: 'id, periodo, turma_disciplinas!inner(turmas!inner(colegio_id))',
    ordem: null,
    ajuste: (q) => q.not('dia_semana', 'is', null)
  });
  const invalidas = posicionadas.filter((h) =>
    h.turma_disciplinas?.turmas?.colegio_id === colegioId && !aulas.has(h.periodo));
  for (const h of invalidas) {
    const { error } = await supabase.from('horario_aulas').update({ dia_semana: null, periodo: null }).eq('id', h.id);
    if (error) throw error;
  }
  return invalidas.length;
}

export function abrirHorariosColegio(colegio, aoSalvar = () => {}) {
  const conteudo = el(`<div>
    <div class="aviso azul" style="margin-bottom:14px">
      Cadastre a grade de horários deste colégio. Marque <strong>Não é aula</strong> nos intervalos (recreio, almoço).
      Os períodos de aula aparecem em Minhas aulas. Se o colégio não tiver grade, vale o padrão do sistema.
    </div>
    <div class="acoes" style="margin-bottom:12px">
      <button type="button" class="btn azul pequeno" id="grade-matutino">Usar padrão matutino (6 aulas + recreio após a 3ª)</button>
      <button type="button" class="btn pequeno" id="grade-novo">+ Adicionar período</button>
      <span id="grade-resumo" class="small muted" style="margin-left:auto"></span>
    </div>
    <div id="grade-linhas"></div>
  </div>`);

  listar('colegio_horarios', { ordem: 'ordem', ajuste: (q) => q.eq('colegio_id', colegio.id) })
    .then((existentes) => {
      const linhas = existentes.length ? existentes : GRADE_PADRAO;
      renderLinhas(conteudo, linhas.map((l) => ({ ...l, inicio: l.inicio, fim: l.fim })));
    })
    .catch(mostrarErro);

  conteudo.querySelector('#grade-matutino').onclick = () => renderLinhas(conteudo, MATUTINO);
  conteudo.querySelector('#grade-novo').onclick = () => {
    const atuais = lerLinhas(conteudo);
    atuais.push({ ordem: atuais.length + 1, tipo: 'aula', rotulo: null, inicio: null, fim: null });
    renderLinhas(conteudo, atuais);
  };

  abrirModal({
    titulo: `Horários · ${colegio.nome}`,
    conteudo,
    grande: true,
    submitLabel: 'Salvar grade',
    onSubmit: async (fechar) => {
      const linhas = lerLinhas(conteudo);
      if (!linhas.length) throw new Error('Cadastre pelo menos um período.');
      if (!linhas.some((l) => l.tipo === 'aula')) throw new Error('A grade precisa ter ao menos um período de aula.');
      const { error: erroApagar } = await supabase.from('colegio_horarios').delete().eq('colegio_id', colegio.id);
      if (erroApagar) throw erroApagar;
      await inserirVarios('colegio_horarios', linhas.map((l) => ({ colegio_id: colegio.id, ...l })));
      const ajustadas = await reajustarAulasPosicionadas(colegio.id, linhas);
      fechar();
      toast(ajustadas ? `Grade salva. ${ajustadas} aula(s) saíram do horário por caírem em intervalo.` : 'Grade salva.', 'ok');
      aoSalvar();
    }
  });
}
