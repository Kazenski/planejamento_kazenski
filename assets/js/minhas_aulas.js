import { supabase } from './supabase.js';
import { listar, inserirVarios, atualizar } from './db.js';
import { esc, toast, mostrarErro, carregando } from './ui.js';
import { DIAS_SEMANA, SERIES } from './config.js';
import { classificarDia, ymd } from './regras.js';

// Horário semanal do professor. Grade de 7 períodos: 1, 2 e 3 antes do recreio; 4 é o recreio; 5, 6 e 7 depois.
const ANO = new Date().getFullYear();
const PERIODOS = [1, 2, 3, 4, 5, 6, 7];
const RECREIO = 4;
const CORES = ['#FF5000', '#0066FF', '#15803D', '#7C3AED', '#B45309', '#0E7490'];

const estado = {
  colegioId: 'todos',
  cursoId: 'todos',
  turmaId: 'todas',
  semana: segundaDe(new Date().toISOString().slice(0, 10))
};
let dados = null;
let arrastando = null;

function cor(texto) {
  let h = 0;
  for (const c of String(texto)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
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

async function carregar() {
  const [colegios, colegioCursos, cursos, turmas, vinculos, horarios, eventos] = await Promise.all([
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
    })
  ]);
  const vinculosIds = new Set(vinculos.map((v) => v.id));
  dados = {
    colegios,
    colegioCursos,
    cursos,
    turmas,
    vinculos,
    horarios: horarios.filter((h) => vinculosIds.has(h.turma_disciplina_id)),
    eventos: eventos.map((e) => ({ ...e, colegios: (e.evento_colegios || []).map((x) => x.colegio_id) }))
  };
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

// Cards do horário que estão dentro do filtro atual.
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

function cardHtml(card, datasSemana) {
  const v = card.vinculo;
  const data = card.dia_semana ? datasSemana[card.dia_semana - 1] : null;
  const cal = data ? calendarioDo(card, data) : { letivo: true, motivo: '' };
  const desativada = data && !cal.letivo;
  const cores = cor(v.disciplinas?.nome || v.id);
  return `
    <div class="aula ${desativada ? 'off' : ''}" draggable="${desativada ? 'false' : 'true'}" data-horario="${card.id}"
      style="border-left-color:${cores}" title="${desativada ? `Sem aula: ${esc(cal.motivo)}` : ''}">
      <strong>${esc(v.disciplinas?.nome || '—')}</strong>
      <div class="small">${esc(v.turmas?.nome || '')}${estado.colegioId === 'todos' ? ` · ${esc(v.turmas?.colegios?.nome || '')}` : ''}</div>
      ${desativada ? `<div class="small">Sem aula: ${esc(cal.motivo)}</div>` : ''}
    </div>`;
}

function grade(semana, visiveis) {
  const datas = [0, 1, 2, 3, 4].map((i) => somarDias(semana, i));
  const cabecalho = `<div class="ma-cab">Período</div>${DIAS_SEMANA.slice(1, 6).map((d, i) => `<div class="ma-cab">${d}<span class="small muted" style="display:block">${fmt(datas[i])}</span></div>`).join('')}`;
  const linhas = PERIODOS.map((p) => {
    if (p === RECREIO) return '<div class="ma-recreio">Recreio</div>';
    const celulas = [1, 2, 3, 4, 5].map((dia) => {
      const aqui = visiveis.filter((h) => h.dia_semana === dia && h.periodo === p);
      const conflito = aqui.length > 1;
      return `<div class="ma-celula ${conflito ? 'conflito' : ''}" data-dia="${dia}" data-periodo="${p}" title="${conflito ? 'Conflito: mais de uma aula neste horário' : ''}">
        ${aqui.map((h) => cardHtml(h, datas)).join('')}
      </div>`;
    }).join('');
    return `<div class="ma-rotulo">${p}º período</div>${celulas}`;
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
            <input type="checkbox" data-leciono="${v.id}" data-aulas="${v.aulas_semana}" ${ativo ? 'checked' : ''}>
            <span>${esc(v.disciplinas?.nome || '—')} <span class="small muted">· ${v.aulas_semana} aula(s)/sem</span></span>
          </label>`;
        }).join('') : '<p class="small muted">Nenhuma disciplina vinculada a esta turma. Cadastre em Aulas por disciplina.</p>'}
      </div>`;
  }).join('') : '<div class="vazio">Nenhuma turma com este filtro.</div>';

  const porTurma = contar(visiveis, (h) => `${h.vinculo.turmas?.nome || '—'}${estado.colegioId === 'todos' ? ` · ${h.vinculo.turmas?.colegios?.nome || ''}` : ''}`);
  const porDisc = contar(visiveis, (h) => h.vinculo.disciplinas?.nome || '—');

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
  main.innerHTML = carregando('Montando seu horário...');
  try {
    await recarregarEDesenhar(main);
  } catch (err) {
    mostrarErro(err);
    return;
  }

  // Filtros
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

  // Navegação de semana
  main.onclick = (e) => {
    if (e.target.closest('#ma-sem-ant')) estado.semana = somarDias(estado.semana, -7);
    else if (e.target.closest('#ma-sem-prox')) estado.semana = somarDias(estado.semana, 7);
    else if (e.target.closest('#ma-hoje')) estado.semana = segundaDe(new Date().toISOString().slice(0, 10));
    else return;
    desenhar(main);
  };

  // Arrastar e soltar entre os dias e períodos
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
        await atualizar('horario_aulas', id, { dia_semana: Number(celula.dataset.dia), periodo: Number(celula.dataset.periodo) });
      }
      await recarregarEDesenhar(main);
    } catch (err) { mostrarErro(err); }
  };
  main.ondragend = () => { arrastando = null; main.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over')); };
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
