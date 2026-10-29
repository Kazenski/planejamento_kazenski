import { listar, getConfig } from './db.js';
import { esc, carregando, mostrarErro } from './ui.js';
import { DIAS_LETIVOS_PADRAO, MESES } from './config.js';
import { diasDoAno, classificarDia, categoriaDia, diasLetivos, aulasPorDia } from './regras.js';

const COR = {
  laranja: '#FF5000',
  azul: '#0066FF',
  marinho: '#001A2E',
  verde: '#15803D',
  cinza: '#9AA3AF',
  ambar: '#F5B041'
};

let graficos = [];

function destruirGraficos() {
  graficos.forEach((g) => g.destroy());
  graficos = [];
}

function grafico(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx || !window.Chart) return;
  graficos.push(new Chart(ctx, config));
}

const base = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { font: { family: 'Open Sans' } } } },
  scales: { x: { ticks: { font: { family: 'Open Sans' } } }, y: { beginAtZero: true, ticks: { precision: 0, font: { family: 'Open Sans' } } } }
};

const CATEGORIAS = [
  ['letivo', 'Dia letivo', COR.verde],
  ['feriado', 'Feriado', COR.laranja],
  ['nao_letivo', 'Recesso ou ponto facultativo', COR.cinza],
  ['pedagogica', 'Atividade pedagógica', COR.azul],
  ['evento', 'Evento curricular extra', COR.ambar]
];

export async function telaPainel(main) {
  destruirGraficos();
  const ano = new Date().getFullYear();

  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Painel de planejamentos</h1>
        <p>Visão geral de ${ano}: planos gerados, aulas, dias letivos e as habilidades mais usadas.</p>
      </div>
    </div>
    <div id="painel-conteudo">${carregando('Montando o painel...')}</div>`;

  try {
    const [planosAnuais, mensais, diarios, habilidadesUsadas, turmaDisc, turmas, colegios, eventos, meta] = await Promise.all([
      listar('planos_anuais', { select: 'id, status, turmas(ano, colegio_id, colegios(nome))', ordem: null }),
      listar('planos_mensais', { select: 'id, status', ordem: null }),
      listar('planos_diarios', { select: 'id, status', ordem: null }),
      listar('planos_anuais_habilidades', { select: 'habilidade_id, habilidades(codigo, eixo)', ordem: null }),
      listar('turma_disciplinas', { select: 'aulas_semana, turma_id, turmas!inner(ano, colegio_id), disciplinas(nome)', ordem: null, ajuste: (q) => q.eq('turmas.ano', ano) }),
      listar('turmas', { select: 'id', ordem: null, ajuste: (q) => q.eq('ano', ano) }),
      listar('colegios', { select: 'id', ordem: null, ajuste: (q) => q.eq('ano', ano) }),
      listar('calendario_eventos', { select: '*, evento_colegios(colegio_id)', ordem: null, ajuste: (q) => q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`) }),
      getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO)
    ]);

    const eventosMapeados = eventos.map((e) => ({ ...e, colegios: (e.evento_colegios || []).map((x) => x.colegio_id) }));
    // Visão geral: considera os eventos de todos os colégios (para contar o que está no calendário).
    const eventosGerais = eventosMapeados.map((e) => ({ ...e, todos_colegios: true }));

    // Dias letivos e categorias por mês (cada dia conta uma vez)
    const categoriasPorMes = {};
    for (let m = 1; m <= 12; m++) categoriasPorMes[m] = Object.fromEntries(CATEGORIAS.map(([k]) => [k, 0]));
    for (const d of diasDoAno(ano)) {
      const cat = categoriaDia(classificarDia(d, eventosGerais, null));
      if (cat) categoriasPorMes[Number(d.slice(5, 7))][cat]++;
    }
    const letivosTotal = diasLetivos(diasDoAno(ano), eventosMapeados, null).length;
    const diferenca = letivosTotal - Number(meta);

    // Aulas por disciplina no ano, respeitando o calendário de cada colégio
    const letivosPorColegio = {};
    const letivosDe = (colegioId) => {
      if (!letivosPorColegio[colegioId]) {
        letivosPorColegio[colegioId] = diasLetivos(diasDoAno(ano), eventosMapeados, colegioId).map((d) => d.data);
      }
      return letivosPorColegio[colegioId];
    };
    const tabelaDisc = {};
    for (const t of turmaDisc) {
      const nome = t.disciplinas?.nome || '—';
      const linha = tabelaDisc[nome] || (tabelaDisc[nome] = { nome, turmas: new Set(), semana: 0, anual: 0 });
      linha.turmas.add(t.turma_id);
      linha.semana += t.aulas_semana;
      const mapa = aulasPorDia(letivosDe(t.turmas?.colegio_id), t.aulas_semana);
      linha.anual += [...mapa.values()].reduce((s, n) => s + n, 0);
    }
    const linhasDisc = Object.values(tabelaDisc).sort((a, b) => b.anual - a.anual);
    const totalAnual = linhasDisc.reduce((s, l) => s + l.anual, 0);

    const habCont = {};
    const eixos = {};
    for (const h of habilidadesUsadas) {
      const cod = h.habilidades?.codigo || '—';
      habCont[cod] = (habCont[cod] || 0) + 1;
      const eixo = h.habilidades?.eixo || 'Sem eixo';
      eixos[eixo] = (eixos[eixo] || 0) + 1;
    }
    const topHab = Object.entries(habCont).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const planosPorColegio = {};
    for (const p of planosAnuais) {
      if (p.turmas?.ano !== ano) continue;
      const nome = p.turmas?.colegios?.nome || '—';
      planosPorColegio[nome] = (planosPorColegio[nome] || 0) + 1;
    }
    const statusAnuais = { rascunho: 0, gerado: 0, aprovado: 0 };
    planosAnuais.forEach((p) => { statusAnuais[p.status] = (statusAnuais[p.status] || 0) + 1; });

    document.getElementById('painel-conteudo').innerHTML = `
      <div class="grid kpis">
        <div class="card kpi"><div class="rotulo">Planos anuais</div><div class="valor">${planosAnuais.length}</div><div class="sub">${planosAnuais.filter((p) => p.status !== 'rascunho').length} gerados com IA</div></div>
        <div class="card kpi azul"><div class="rotulo">Planos mensais</div><div class="valor">${mensais.length}</div><div class="sub">fevereiro a dezembro</div></div>
        <div class="card kpi marinho"><div class="rotulo">Planos diários</div><div class="valor">${diarios.length}</div><div class="sub">dias de aula planejados</div></div>
        <div class="card kpi verde"><div class="rotulo">Dias letivos em ${ano}</div><div class="valor">${letivosTotal}</div><div class="sub">${diferenca === 0 ? 'meta atingida' : diferenca > 0 ? `${diferenca} acima da meta de ${meta}` : `faltam ${Math.abs(diferenca)} para ${meta}`}</div></div>
        <div class="card kpi azul"><div class="rotulo">Habilidades usadas</div><div class="valor">${Object.keys(habCont).length}</div><div class="sub">códigos distintos nos anuais</div></div>
        <div class="card kpi"><div class="rotulo">Turmas em ${ano}</div><div class="valor">${turmas.length}</div><div class="sub">${colegios.length} colégio(s) em ${ano}</div></div>
      </div>

      ${planosAnuais.length === 0 ? `<div class="aviso azul" style="margin-top:16px">Ainda não há planos. Comece cadastrando colégio, turma e disciplinas, depois crie o plano anual.</div>` : ''}

      <div class="grid graficos" style="margin-top:16px">
        <div class="card" style="grid-column:1/-1"><h3>Calendário de ${ano}: dias por mês e categoria</h3><p class="small muted" style="margin-top:-6px">Fins de semana não entram. Cada dia conta em uma categoria só.</p><div class="grafico" style="height:340px"><canvas id="g-letivos"></canvas></div></div>
        <div class="card" style="grid-column:1/-1">
          <h3>Aulas por disciplina em ${ano}</h3>
          <p class="small muted" style="margin-top:-6px">Aulas no ano respeitam o calendário de cada colégio. Total: <strong>${totalAnual}</strong> aulas.</p>
          ${linhasDisc.length ? `
          <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
            <thead><tr><th>Disciplina</th><th>Turmas</th><th>Aulas por semana (soma)</th><th>Aulas no ano</th><th>Participação</th></tr></thead>
            <tbody>${linhasDisc.map((l) => `<tr>
              <td><strong>${esc(l.nome)}</strong></td>
              <td>${l.turmas.size}</td>
              <td>${l.semana}</td>
              <td><span class="tag laranja">${l.anual}</span></td>
              <td style="min-width:180px"><div style="background:var(--card);border-radius:6px;height:10px;overflow:hidden"><div style="height:10px;width:${totalAnual ? Math.round((l.anual / totalAnual) * 100) : 0}%;background:var(--laranja)"></div></div><span class="small muted">${totalAnual ? Math.round((l.anual / totalAnual) * 100) : 0}%</span></td>
            </tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhuma disciplina vinculada a turmas deste ano.</div>'}
        </div>
        <div class="card"><h3>Habilidades mais usadas nos planos anuais</h3><div class="grafico"><canvas id="g-habilidades"></canvas></div></div>
        <div class="card"><h3>Eixos das habilidades usadas</h3><div class="grafico"><canvas id="g-eixos"></canvas></div></div>
        <div class="card"><h3>Status dos planos anuais</h3><div class="grafico"><canvas id="g-status"></canvas></div></div>
        <div class="card"><h3>Planos anuais por colégio em ${ano}</h3><div class="grafico"><canvas id="g-colegio"></canvas></div></div>
      </div>`;

    const meses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    grafico('g-letivos', {
      type: 'bar',
      data: {
        labels: meses.map((m) => MESES[m - 1].slice(0, 3)),
        datasets: CATEGORIAS.map(([k, rotulo, cor]) => ({
          label: rotulo,
          data: meses.map((m) => categoriasPorMes[m][k]),
          backgroundColor: cor,
          borderRadius: 4,
          stack: 'dias'
        }))
      },
      options: { ...base, scales: { x: { stacked: true, ticks: { font: { family: 'Open Sans' } } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } }
    });
    grafico('g-habilidades', {
      type: 'bar',
      data: {
        labels: topHab.map(([c]) => c),
        datasets: [{ label: 'Planos que usam', data: topHab.map(([, n]) => n), backgroundColor: COR.laranja, borderRadius: 6 }]
      },
      options: { ...base, indexAxis: 'y' }
    });
    grafico('g-eixos', {
      type: 'doughnut',
      data: {
        labels: Object.keys(eixos),
        datasets: [{ data: Object.values(eixos), backgroundColor: [COR.laranja, COR.azul, COR.marinho, COR.verde, COR.cinza, COR.ambar] }]
      },
      options: { ...base, scales: undefined }
    });
    grafico('g-status', {
      type: 'doughnut',
      data: {
        labels: ['Rascunho', 'Gerado', 'Aprovado'],
        datasets: [{ data: [statusAnuais.rascunho, statusAnuais.gerado, statusAnuais.aprovado], backgroundColor: [COR.cinza, COR.azul, COR.verde] }]
      },
      options: { ...base, scales: undefined }
    });
    grafico('g-colegio', {
      type: 'bar',
      data: {
        labels: Object.keys(planosPorColegio),
        datasets: [{ label: 'Planos anuais', data: Object.values(planosPorColegio), backgroundColor: COR.marinho, borderRadius: 6 }]
      },
      options: base
    });
  } catch (err) {
    mostrarErro(err);
    document.getElementById('painel-conteudo').innerHTML = '<div class="aviso">Não foi possível carregar o painel.</div>';
  }
}

export function sairDoPainel() {
  destruirGraficos();
}
