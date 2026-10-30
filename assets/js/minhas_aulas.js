import { supabase } from './supabase.js';
import { listar, inserirVarios, atualizar } from './db.js';
import { esc, toast, mostrarErro, carregando, abrirModal } from './ui.js';
import { DIAS_SEMANA, SERIES } from './config.js';
import { classificarDia } from './regras.js';
import { GRADE_PADRAO } from './horarios_colegio.js';

// Horário semanal do professor. A grade vem de cada colégio (Cadastros > Colégios > Horários).
// Colégio sem grade usa o padrão do sistema.
const ANO = new Date().getFullYear();
// Paleta de cores bem distintas. Cada colégio (e cada disciplina) recebe uma cor própria, por posição na lista.
const PALETA = ['#FF5000', '#0066FF', '#15803D', '#7C3AED', '#E11D48', '#0E7490', '#B45309', '#4D7C0F', '#DB2777', '#1D4ED8', '#A16207', '#334155'];

const estado = {
  colegioId: 'todos',
  cursoId: 'todos',
  turmaId: 'todas',
  semana: segundaDe(new Date().toISOString().slice(0, 10))
};
let dados = null;
let arrastando = null;
let selecionadaId = null;

function colegioCor(colegioId) {
  const i = dados.colegios.findIndex((c) => c.id === colegioId);
  return PALETA[(i < 0 ? 0 : i) % PALETA.length];
}

function disciplinaCor(disciplinaId) {
  const ids = [...new Set(dados.vinculos.map((v) => v.disciplina_id))].sort();
  const i = ids.indexOf(disciplinaId);
  return PALETA[(i < 0 ? 0 : i) % PALETA.length];
}

function segundaDe(dataTexto) {
  const d = new Date(dataTexto + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function somarDias(dataTexto, n) {
  const d = new Date(dataTexto + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmt = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const hora = (t) => (t ? String(t).slice(0, 5) : '');

async function carregar() {
  const [colegios, colegioCursos, cursos, turmas, vinculos, horarios, eventos, grades] = await Promise.all([
    listar('colegios', { ordem: 'nome', ajuste: (q) => q.eq('ano', ANO) }),
    listar('colegio_cursos', { select: 'colegio_id, curso_id', ordem: null }),
    listar('cursos', { ordem: 'nome' }),
    listar('turmas', { select: '*, colegios(nome), cursos(nome)', ordem: 'nome', ajuste: (q) => q.eq('ano', ANO) }),
    listar('turma_disciplinas', {
      select: 'id, turma_id, disciplina_id, aulas_semana, turmas!inner(nome, ano, serie, colegio_id, curso_id, colegios(nome)), disciplinas(nome)',
      ordem: null,
      ajuste: (q) => q.eq('turmas.ano', ANO)
    }),
    listar('horario_aulas', { ordem: 'ordem' }),
    listar('calendario_eventos', {
      select: '*, evento_colegios(colegio_id)',
      ordem: 'data',
      ajuste: (q) => q.gte('data', `${ANO}-01-01`).lte('data', `${ANO}-12-31`)
    }),
    listar('colegio_horarios', { ordem: 'ordem' })
  ]);
  const vinculosIds = new Set(vinculos.map((v) => v.id));
  const gradesPorColegio = new Map();
  for (const g of grades) {
    if (!gradesPorColegio.has(g.colegio_id)) gradesPorColegio.set(g.colegio_id, []);
    gradesPorColegio.get(g.colegio_id).push(g);
  }
  dados = {
    colegios,
    colegioCursos,
    cursos,
    turmas,
    vinculos,
    grades: gradesPorColegio,
    horarios: horarios.filter((h) => vinculosIds.has(h.turma_disciplina_id)),
    eventos: eventos.map((e) => ({ ...e, colegios: (e.evento_colegios || []).map((x) => x.colegio_id) }))
  };
}

// Linhas da grade de um colégio: ordem, tipo ('aula' ou 'intervalo'), rótulo e horários.
function gradeDoColegio(colegioId) {
  const cadastrada = dados.grades.get(colegioId);
  if (cadastrada?.length) return cadastrada;
  return GRADE_PADRAO.map((l) => ({ ordem: l.ordem, tipo: l.tipo, rotulo: l.rotulo || null, inicio: null, fim: null }));
}

// Grade exibida: a do colégio escolhido, ou a união das grades de todos os colégios (uma linha por ordem).
function linhasDaGrade() {
  if (estado.colegioId !== 'todos') return gradeDoColegio(estado.colegioId);
  const ids = dados.colegios.map((c) => c.id);
  const todas = ids.length ? ids.map(gradeDoColegio) : [gradeDoColegio(null)];
  const maior = Math.max(...todas.map((g) => g.length));
  const linhas = [];
  for (let o = 1; o <= maior; o++) {
    const naOrdem = todas.map((g) => g.find((l) => l.ordem === o)).filter(Boolean);
    const algumaAula = naOrdem.some((l) => l.tipo === 'aula');
    const rotulo = naOrdem.find((l) => l.rotulo)?.rotulo || 'Intervalo';
    linhas.push({ ordem: o, tipo: algumaAula ? 'aula' : 'intervalo', rotulo });
  }
  return linhas;
}

function periodoEhAula(colegioId, ordem) {
  return gradeDoColegio(colegioId).some((l) => l.ordem === ordem && l.tipo === 'aula');
}

// Cursos que aparecem no filtro: os do colégio escolhido (ou todos, se nenhum colégio).
function cursosDoFiltro() {
  if (estado.colegioId === 'todos') return dados.cursos;
  const ids = new Set(dados.colegioCursos.filter((x) => x.colegio_id === estado.colegioId).map((x) => x.curso_id));
  return dados.cursos.filter((c) => ids.has(c.id));
}

function turmasDoFiltro() {
  return dados.turmas.filter((t) =>
    (estado.colegioId === 'todos' || t.colegio_id === estado.colegioId) &&
    (estado.cursoId === 'todos' || t.curso_id === estado.cursoId) &&
    (estado.turmaId === 'todas' || t.id === estado.turmaId));
}

function vinculosVisiveis() {
  const turmas = new Set(turmasDoFiltro().map((t) => t.id));
  return dados.vinculos.filter((v) => turmas.has(v.turma_id));
}

function horariosVisiveis() {
  const vinc = new Map(vinculosVisiveis().map((v) => [v.id, v]));
  return dados.horarios
    .filter((h) => vinc.has(h.turma_disciplina_id))
    .map((h) => ({ ...h, vinculo: vinc.get(h.turma_disciplina_id) }));
}

function calendarioDo(card, data) {
  const colegioId = card.vinculo.turmas?.colegio_id;
  const c = classificarDia(data, dados.eventos, colegioId);
  return {
    letivo: c.letivo,
    motivo: c.letivo ? '' : (c.eventos.map((e) => e.nome).join(', ') || (c.util ? 'sem aula' : 'fim de semana'))
  };
}

// Na visão geral, a cor é do colégio. Num colégio só, a cor é da disciplina.
function corDoCard(v) {
  return estado.colegioId === 'todos' ? colegioCor(v.turmas?.colegio_id) : disciplinaCor(v.disciplina_id);
}

// Horário da aula: o próprio, se cadastrado; senão, o do período na grade do colégio.
function horarioDaAula(card) {
  if (card.inicio || card.fim) return { inicio: card.inicio, fim: card.fim, proprio: true };
  const linha = gradeDoColegio(card.vinculo.turmas?.colegio_id).find((l) => l.ordem === card.periodo);
  return { inicio: linha?.inicio, fim: linha?.fim, proprio: false };
}

function cardHtml(card, datasSemana) {
  const v = card.vinculo;
  const data = card.dia_semana ? datasSemana[card.dia_semana - 1] : null;
  const cal = data ? calendarioDo(card, data) : { letivo: true, motivo: '' };
  const desativada = data && !cal.letivo;
  const h = horarioDaAula(card);
  const faixa = h.inicio ? `${hora(h.inicio)}${h.fim ? '–' + hora(h.fim) : ''}` : '';
  return `
    <div class="aula ${desativada ? 'off' : ''} ${selecionadaId === card.id ? 'selecionada' : ''}" draggable="${desativada ? 'false' : 'true'}" data-horario="${card.id}"
      style="border-left-color:${corDoCard(v)}" title="${desativada ? `Sem aula: ${esc(cal.motivo)}` : 'Clique para selecionar e depois clique num dia e período'}">
      <button type="button" class="aula-hora" data-hora="${card.id}" title="Horário desta aula">⏱</button>
      <strong>${esc(v.disciplinas?.nome || '—')}</strong>
      <div class="small">${esc(v.turmas?.nome || '')}${estado.colegioId === 'todos' ? ` · ${esc(v.turmas?.colegios?.nome || '')}` : ''}</div>
      ${faixa ? `<div class="small"><span class="muted">⏱</span> ${esc(faixa)}${h.proprio ? ' <span class="tag laranja" style="font-size:10px">próprio</span>' : ''}</div>` : ''}
      ${desativada ? `<div class="small">Sem aula: ${esc(cal.motivo)}</div>` : ''}
    </div>`;
}

// Edita o horário de uma aula específica. Em branco, a aula volta a usar o horário do período.
function abrirHorarioAula(card) {
  const h = horarioDaAula(card);
  const conteudo = document.createElement('div');
  conteudo.innerHTML = `
    <div class="aviso azul" style="margin-bottom:14px">
      <strong>${esc(card.vinculo.disciplinas?.nome || '')}</strong> · ${esc(card.vinculo.turmas?.nome || '')}
      <br><span class="small">Horário padrão do período: ${h.inicio ? `${hora(h.inicio)}–${hora(h.fim)}` : 'não cadastrado na grade do colégio'}</span>
    </div>
    <div class="campos-grid">
      <label class="campo"><span>Início desta aula</span><input type="time" id="ha-inicio" value="${card.inicio ? hora(card.inicio) : ''}"></label>
      <label class="campo"><span>Fim desta aula</span><input type="time" id="ha-fim" value="${card.fim ? hora(card.fim) : ''}"></label>
    </div>
    <p class="small muted" style="margin-top:12px">Deixe em branco para usar o horário do período.</p>`;
  abrirModal({
    titulo: 'Horário desta aula',
    conteudo,
    grande: false,
    acoesExtras: [{ label: 'Usar horário do período', onClick: async (fechar) => {
      try {
        await atualizar('horario_aulas', card.id, { inicio: null, fim: null });
        fechar();
        toast('A aula voltou a usar o horário do período.', 'ok');
        await recarregarEDesenhar(mainRef);
      } catch (err) { mostrarErro(err); }
    } }],
    onSubmit: async (fechar) => {
      const inicio = conteudo.querySelector('#ha-inicio').value || null;
      const fim = conteudo.querySelector('#ha-fim').value || null;
      if (inicio && fim && fim <= inicio) throw new Error('O fim precisa ser depois do início.');
      await atualizar('horario_aulas', card.id, { inicio, fim });
      fechar();
      toast('Horário da aula salvo.', 'ok');
      await recarregarEDesenhar(mainRef);
    }
  });
}

let mainRef = null;

function grade(semana, visiveis) {
  const datas = [0, 1, 2, 3, 4].map((i) => somarDias(semana, i));
  const cabecalho = `<div class="ma-cab">Período</div>${DIAS_SEMANA.slice(1, 6).map((d, i) => `<div class="ma-cab">${d}<span class="small muted" style="display:block">${fmt(datas[i])}</span></div>`).join('')}`;
  const linhas = linhasDaGrade().map((l) => {
    const intervalo = l.tipo === 'intervalo';
    if (intervalo) {
      const horas = estado.colegioId !== 'todos' && l.inicio ? ` · ${hora(l.inicio)}–${hora(l.fim)}` : '';
      return `<div class="ma-recreio">${esc(l.rotulo || 'Intervalo')}${esc(horas)}</div>`;
    }
    const celulas = [1, 2, 3, 4, 5].map((dia) => {
      const aqui = visiveis.filter((h) => h.dia_semana === dia && h.periodo === l.ordem);
      const conflito = aqui.length > 1;
      return `<div class="ma-celula ${conflito ? 'conflito' : ''}" data-dia="${dia}" data-periodo="${l.ordem}" title="${conflito ? 'Conflito: mais de uma aula neste horário' : ''}">
        ${aqui.map((h) => cardHtml(h, datas)).join('')}
      </div>`;
    }).join('');
    const horas = estado.colegioId !== 'todos' && l.inicio ? `<span class="small muted">${hora(l.inicio)}–${hora(l.fim)}</span>` : '';
    return `<div class="ma-rotulo">${l.ordem}º ${horas}</div>${celulas}`;
  }).join('');
  return `<div class="ma-grade">${cabecalho}${linhas}</div>`;
}

function contar(lista, chave) {
  const m = new Map();
  for (const h of lista) {
    const k = chave(h);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function desenhar(main) {
  const semana = estado.semana;
  const datas = [0, 1, 2, 3, 4].map((i) => somarDias(semana, i));
  const visiveis = horariosVisiveis();
  const cadastradas = visiveis.length;
  const posicionadas = visiveis.filter((h) => h.dia_semana).length;
  const naoPosicionadas = cadastradas - posicionadas;
  let letivas = 0;
  let semAula = 0;
  for (const h of visiveis) {
    if (!h.dia_semana) continue;
    const cal = calendarioDo(h, datas[h.dia_semana - 1]);
    if (cal.letivo) letivas++; else semAula++;
  }

  const colegiosOpt = `<option value="todos" ${estado.colegioId === 'todos' ? 'selected' : ''}>Todos os colégios</option>` +
    dados.colegios.map((c) => `<option value="${c.id}" ${estado.colegioId === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const cursosOpt = `<option value="todos" ${estado.cursoId === 'todos' ? 'selected' : ''}>Todos os cursos</option>` +
    cursosDoFiltro().map((c) => `<option value="${c.id}" ${estado.cursoId === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const turmasOpt = `<option value="todas" ${estado.turmaId === 'todas' ? 'selected' : ''}>Todas as turmas</option>` +
    turmasDoFiltro().map((t) => `<option value="${t.id}" ${estado.turmaId === t.id ? 'selected' : ''}>${esc(t.nome)} · ${esc(t.colegios?.nome || '')}</option>`).join('');

  const turmasFiltradas = turmasDoFiltro();
  const listaVinculos = turmasFiltradas.length ? turmasFiltradas.map((t) => {
    const vs = dados.vinculos.filter((v) => v.turma_id === t.id);
    return `
      <div class="ma-turma">
        <div><strong>${esc(t.nome)}</strong> <span class="small muted">${esc(SERIES[t.serie] || '')} · ${esc(t.cursos?.nome || '')}${estado.colegioId === 'todos' ? ` · ${esc(t.colegios?.nome || '')}` : ''}</span></div>
        ${vs.length ? vs.map((v) => {
          const ativo = dados.horarios.some((h) => h.turma_disciplina_id === v.id);
          return `<label class="ma-disc">
            <input type="checkbox" data-leciono="${v.id}" data-aulas="${v.aulas_semana}" data-colegio="${v.turmas?.colegio_id}" ${ativo ? 'checked' : ''}>
            <span>${esc(v.disciplinas?.nome || '—')} <span class="small muted">· ${v.aulas_semana} aula(s)/sem</span></span>
          </label>`;
        }).join('') : '<p class="small muted">Nenhuma disciplina vinculada a esta turma. Cadastre em Aulas por disciplina.</p>'}
      </div>`;
  }).join('') : '<div class="vazio">Nenhuma turma com este filtro.</div>';

  const porTurma = contar(visiveis, (h) => `${h.vinculo.turmas?.nome || '—'}${estado.colegioId === 'todos' ? ` · ${h.vinculo.turmas?.colegios?.nome || ''}` : ''}`);
  const porDisc = contar(visiveis, (h) => h.vinculo.disciplinas?.nome || '—');
  const legenda = estado.colegioId === 'todos' && dados.colegios.length
    ? `<div class="ma-legenda">${dados.colegios.map((c) => `<span style="--cor:${colegioCor(c.id)}">${esc(c.nome)}</span>`).join('')}</div>`
    : '';

  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Minhas aulas</h1>
        <p>Escolha o colégio, o curso e a turma. Marque as disciplinas que você leciona e arraste as aulas para o horário da semana. Dias sem aula no calendário ficam cinza.</p>
      </div>
    </div>

    <div class="filtros">
      <label class="campo"><span>Colégio</span><select id="ma-colegio">${colegiosOpt}</select></label>
      <label class="campo"><span>Curso</span><select id="ma-curso">${cursosOpt}</select></label>
      <label class="campo"><span>Turma</span><select id="ma-turma">${turmasOpt}</select></label>
    </div>

    <div class="ma-layout">
      <div class="card">
        <h3 style="margin-bottom:12px">Disciplinas que eu leciono</h3>
        ${listaVinculos}
      </div>

      <div>
        <div class="cal-nav">
          <button class="btn pequeno" id="ma-sem-ant" type="button">‹ Semana</button>
          <span class="mes-titulo" style="min-width:300px;font-size:18px">Semana de ${fmt(datas[0])} a ${fmt(datas[4])}/${datas[4].slice(0, 4)}</span>
          <button class="btn pequeno" id="ma-sem-prox" type="button">Semana ›</button>
          <button class="btn pequeno" id="ma-hoje" type="button">Hoje</button>
        </div>

        <div class="grid kpis" style="margin-bottom:16px">
          <div class="card kpi"><div class="rotulo">Aulas cadastradas</div><div class="valor">${cadastradas}</div><div class="sub">${posicionadas} no horário · ${naoPosicionadas} sem dia</div></div>
          <div class="card kpi verde"><div class="rotulo">Aulas letivas nesta semana</div><div class="valor">${letivas}</div><div class="sub">já posicionadas</div></div>
          <div class="card kpi"><div class="rotulo">Caem em dia sem aula</div><div class="valor">${semAula}</div><div class="sub">feriado ou recesso do calendário</div></div>
        </div>

        <div class="card">
          ${selecionadaId ? `<div class="ma-barra-sel">
            <span><strong>Aula selecionada:</strong> ${esc(visiveis.find((h) => h.id === selecionadaId)?.vinculo.disciplinas?.nome || '')} — clique num dia e período para colocar, ou na área "sem dia" para tirar do horário.</span>
            <button class="btn pequeno" id="ma-cancelar" type="button">Cancelar</button>
          </div>` : '<p class="small muted" style="margin:0 0 10px">Clique numa aula para selecioná-la. Depois clique num dia e período. Você também pode arrastar.</p>'}
          ${legenda}
          <div id="ma-bandeja" class="ma-bandeja" data-bandeja="1">
            <strong class="small">Aulas sem dia (arraste para o horário):</strong>
            ${visiveis.filter((h) => !h.dia_semana).map((h) => cardHtml(h, datas)).join('') || '<span class="small muted">Nenhuma aula sem dia.</span>'}
          </div>
          ${grade(semana, visiveis.filter((h) => h.dia_semana))}
        </div>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:16px">
          <div class="card"><h3>Aulas por turma</h3>
            ${porTurma.length ? `<table class="tabela"><tbody>${porTurma.map(([k, n]) => `<tr><td>${esc(k)}</td><td><span class="tag laranja">${n}</span></td></tr>`).join('')}</tbody></table>` : '<p class="small muted">Sem aulas no filtro.</p>'}
          </div>
          <div class="card"><h3>Aulas por disciplina</h3>
            ${porDisc.length ? `<table class="tabela"><tbody>${porDisc.map(([k, n]) => `<tr><td>${esc(k)}</td><td><span class="tag azul">${n}</span></td></tr>`).join('')}</tbody></table>` : '<p class="small muted">Sem aulas no filtro.</p>'}
          </div>
          <div class="card"><h3>Total da semana</h3>
            <p><strong>${cadastradas}</strong> aulas por semana no filtro.</p>
            <p class="small muted">Só conta as aulas que você cadastrou em "Disciplinas que eu leciono".</p>
          </div>
        </div>
      </div>
    </div>`;
}

async function recarregarEDesenhar(main) {
  await carregar();
  desenhar(main);
}

export async function telaMinhasAulas(main) {
  mainRef = main;
  main.innerHTML = carregando('Montando seu horário...');
  try {
    await recarregarEDesenhar(main);
  } catch (err) {
    mostrarErro(err);
    return;
  }

  main.onchange = async (e) => {
    const alvo = e.target;
    if (alvo.id === 'ma-colegio') {
      estado.colegioId = alvo.value;
      estado.cursoId = 'todos';
      estado.turmaId = 'todas';
    } else if (alvo.id === 'ma-curso') {
      estado.cursoId = alvo.value;
      estado.turmaId = 'todas';
    } else if (alvo.id === 'ma-turma') {
      estado.turmaId = alvo.value;
    } else if (alvo.dataset.leciono) {
      try {
        await alternarVinculo(alvo);
        await recarregarEDesenhar(main);
      } catch (err) { mostrarErro(err); }
      return;
    }
    desenhar(main);
  };

  main.onclick = async (e) => {
    const botaoHora = e.target.closest('.aula-hora');
    if (botaoHora) {
      const card = horariosVisiveis().find((h) => h.id === botaoHora.dataset.hora);
      if (card) abrirHorarioAula(card);
      return;
    }
    const aula = e.target.closest('.aula');
    if (aula) {
      selecionadaId = selecionadaId === aula.dataset.horario ? null : aula.dataset.horario;
      desenhar(main);
      return;
    }
    if (e.target.closest('#ma-cancelar')) {
      selecionadaId = null;
      desenhar(main);
      return;
    }
    const destino = e.target.closest('.ma-celula, [data-bandeja]');
    if (destino && selecionadaId) {
      try {
        if (destino.dataset.bandeja) {
          await atualizar('horario_aulas', selecionadaId, { dia_semana: null, periodo: null });
        } else {
          const ok = await posicionar(selecionadaId, Number(destino.dataset.dia), Number(destino.dataset.periodo));
          if (!ok) return;
        }
        selecionadaId = null;
        await recarregarEDesenhar(main);
      } catch (err) { mostrarErro(err); }
      return;
    }
    if (e.target.closest('#ma-sem-ant')) estado.semana = somarDias(estado.semana, -7);
    else if (e.target.closest('#ma-sem-prox')) estado.semana = somarDias(estado.semana, 7);
    else if (e.target.closest('#ma-hoje')) estado.semana = segundaDe(new Date().toISOString().slice(0, 10));
    else return;
    desenhar(main);
  };

  main.ondragstart = (e) => {
    const card = e.target.closest('.aula');
    if (!card || card.getAttribute('draggable') !== 'true') return e.preventDefault();
    arrastando = card.dataset.horario;
    e.dataTransfer.setData('text/plain', arrastando);
    e.dataTransfer.effectAllowed = 'move';
  };
  main.ondragover = (e) => {
    const celula = e.target.closest('.ma-celula, [data-bandeja]');
    if (!celula || !arrastando) return;
    e.preventDefault();
    main.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over'));
    celula.classList.add('drop-over');
  };
  main.ondragleave = (e) => {
    e.target.closest?.('.ma-celula, [data-bandeja]')?.classList.remove('drop-over');
  };
  main.ondrop = async (e) => {
    const celula = e.target.closest('.ma-celula, [data-bandeja]');
    if (!celula || !arrastando) return;
    e.preventDefault();
    const id = arrastando;
    arrastando = null;
    main.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over'));
    try {
      if (celula.dataset.bandeja) {
        await atualizar('horario_aulas', id, { dia_semana: null, periodo: null });
      } else {
        const h = dados.horarios.find((x) => x.id === id);
        const colegioId = dados.vinculos.find((v) => v.id === h?.turma_disciplina_id)?.turmas?.colegio_id;
        const ordem = Number(celula.dataset.periodo);
        if (colegioId && !periodoEhAula(colegioId, ordem)) {
          toast('Este período é intervalo no colégio desta aula.', 'erro');
          return;
        }
        await atualizar('horario_aulas', id, { dia_semana: Number(celula.dataset.dia), periodo: ordem });
      }
      await recarregarEDesenhar(main);
    } catch (err) { mostrarErro(err); }
  };
  main.ondragend = () => { arrastando = null; main.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over')); };
}

// Coloca uma aula em um dia e período, se o período for aula no colégio dela.
async function posicionar(id, dia, ordem) {
  const h = dados.horarios.find((x) => x.id === id);
  const colegioId = dados.vinculos.find((v) => v.id === h?.turma_disciplina_id)?.turmas?.colegio_id;
  if (colegioId && !periodoEhAula(colegioId, ordem)) {
    toast('Este período é intervalo no colégio desta aula.', 'erro');
    return false;
  }
  await atualizar('horario_aulas', id, { dia_semana: dia, periodo: ordem });
  return true;
}

// Liga ou desliga uma disciplina da turma para o professor.
async function alternarVinculo(input) {
  const vinculoId = input.dataset.leciono;
  const aulas = Number(input.dataset.aulas);
  if (input.checked) {
    await inserirVarios('horario_aulas', Array.from({ length: aulas }, (_, i) => ({ turma_disciplina_id: vinculoId, ordem: i + 1 })));
    toast('Disciplina adicionada. Arraste as aulas para o horário.', 'ok');
    return;
  }
  const existentes = dados.horarios.filter((h) => h.turma_disciplina_id === vinculoId);
  if (existentes.some((h) => h.dia_semana) && !window.confirm('Esta disciplina já está no horário. Ao desmarcar, as aulas dela saem do horário. Continuar?')) {
    input.checked = true;
    return;
  }
  const { error } = await supabase.from('horario_aulas').delete().eq('turma_disciplina_id', vinculoId);
  if (error) throw error;
  toast('Disciplina removida do seu horário.', 'ok');
}
