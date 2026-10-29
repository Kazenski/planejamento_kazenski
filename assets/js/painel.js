import { listar, getConfig } from './db.js';
import { esc, carregando, mostrarErro } from './ui.js';
import { DIAS_LETIVOS_PADRAO, MESES } from './config.js';
import { diasDoAno, diasLetivos, contarLetivos } from './regras.js';

const COR = {
  laranja: '#FF5000',
  laranjaSuave: 'rgba(255,80,0,.15)',
  azul: '#0066FF',
  marinho: '#001A2E',
  verde: '#15803D',
  cinza: '#9AA3AF'
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
      listar('turma_disciplinas', { select: 'aulas_semana, turmas!inner(ano), disciplinas(nome)', ordem: null, ajuste: (q) => q.eq('turmas.ano', ano) }),
      listar('turmas', { select: 'id', ordem: null, ajuste: (q) => q.eq('ano', ano) }),
      listar('colegios', { select: 'id', ordem: null }),
      listar('calendario_eventos', { select: 'data, dia_letivo, todos_colegios, tipo, nome', ordem: null, ajuste: (q) => q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`) }),
      getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO)
    ]);

    const letivos = diasLetivos(diasDoAno(ano), eventos.map((e) => ({ ...e, colegios: [] })), null).map((d) => d.data);
    const letivosPorMes = contarLetivos(letivos);
    const totalLetivos = letivos.length;

    const habCont = {};
    const eixos = {};
    for (const h of habilidadesUsadas) {
      const cod = h.habilidades?.codigo || '—';
      habCont[cod] = (habCont[cod] || 0) + 1;
      const eixo = h.habilidades?.eixo || 'Sem eixo';
      eixos[eixo] = (eixos[eixo] || 0) + 1;
    }
    const topHab = Object.entries(habCont).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const aulasPorDisc = {};
    for (const t of turmaDisc) {
      const nome = t.disciplinas?.nome || '—';
      aulasPorDisc[nome] = (aulasPorDisc[nome] || 0) + t.aulas_semana;
    }

    const planosPorColegio = {};
    for (const p of planosAnuais) {
      if (p.turmas?.ano !== ano) continue;
      const nome = p.turmas?.colegios?.nome || '—';
      planosPorColegio[nome] = (planosPorColegio[nome] || 0) + 1;
    }

    const statusAnuais = { rascunho: 0, gerado: 0, aprovado: 0 };
    planosAnuais.forEach((p) => { statusAnuais[p.status] = (statusAnuais[p.status] || 0) + 1; });

    const diferenca = totalLetivos - Number(meta);

    document.getElementById('painel-conteudo').innerHTML = `
      <div class="grid kpis">
        <div class="card kpi"><div class="rotulo">Planos anuais</div><div class="valor">${planosAnuais.length}</div><div class="sub">${planosAnuais.filter((p) => p.status !== 'rascunho').length} gerados com IA</div></div>
        <div class="card kpi azul"><div class="rotulo">Planos mensais</div><div class="valor">${mensais.length}</div><div class="sub">fevereiro a dezembro</div></div>
        <div class="card kpi marinho"><div class="rotulo">Planos diários</div><div class="valor">${diarios.length}</div><div class="sub">dias de aula planejados</div></div>
        <div class="card kpi verde"><div class="rotulo">Dias letivos em ${ano}</div><div class="valor">${totalLetivos}</div><div class="sub">${diferenca === 0 ? 'meta atingida' : diferenca > 0 ? `${diferenca} acima da meta de ${meta}` : `faltam ${Math.abs(diferenca)} para ${meta}`}</div></div>
        <div class="card kpi azul"><div class="rotulo">Habilidades usadas</div><div class="valor">${Object.keys(habCont).length}</div><div class="sub">códigos distintos nos anuais</div></div>
        <div class="card kpi"><div class="rotulo">Turmas em ${ano}</div><div class="valor">${turmas.length}</div><div class="sub">${colegios.length} colégio(s) cadastrado(s)</div></div>
      </div>

      ${planosAnuais.length === 0 ? `<div class="aviso azul" style="margin-top:16px">Ainda não há planos. Comece cadastrando colégio, turma e disciplinas, depois crie o plano anual.</div>` : ''}

      <div class="grid graficos" style="margin-top:16px">
        <div class="card"><h3>Dias letivos por mês em ${ano}</h3><div class="grafico"><canvas id="g-letivos"></canvas></div></div>
        <div class="card"><h3>Aulas por semana por disciplina</h3><div class="grafico"><canvas id="g-aulas"></canvas></div></div>
        <div class="card"><h3>Habilidades mais usadas nos planos anuais</h3><div class="grafico"><canvas id="g-habilidades"></canvas></div></div>
        <div class="card"><h3>Eixos das habilidades usadas</h3><div class="grafico"><canvas id="g-eixos"></canvas></div></div>
        <div class="card"><h3>Status dos planos anuais</h3><div class="grafico"><canvas id="g-status"></canvas></div></div>
        <div class="card"><h3>Planos anuais por colégio em ${ano}</h3><div class="grafico"><canvas id="g-colegio"></canvas></div></div>
      </div>`;

    const rotuloMes = MESES.slice(1);
    grafico('g-letivos', {
      type: 'bar',
      data: {
        labels: rotuloMes.map((m) => m.slice(0, 3)),
        datasets: [{ label: 'Dias letivos', data: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => letivosPorMes[m] || 0), backgroundColor: COR.laranja, borderRadius: 6 }]
      },
      options: base
    });
    grafico('g-aulas', {
      type: 'bar',
      data: {
        labels: Object.keys(aulasPorDisc),
        datasets: [{ label: 'Aulas por semana', data: Object.values(aulasPorDisc), backgroundColor: COR.azul, borderRadius: 6 }]
      },
      options: { ...base, indexAxis: 'y' }
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
        datasets: [{ data: Object.values(eixos), backgroundColor: [COR.laranja, COR.azul, COR.marinho, COR.verde, COR.cinza, '#FFB347'] }]
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
