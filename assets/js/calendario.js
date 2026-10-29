import { supabase } from './supabase.js';
import { listar, inserir, excluir, getConfig } from './db.js';
import { esc, el, abrirModal, fecharModal, formulario, toast, mostrarErro, carregando } from './ui.js';
import { MESES, DIAS_SEMANA, TIPOS_EVENTO, DIAS_LETIVOS_PADRAO, URL_FERIADOS } from './config.js';
import { diasDoMes, diasDoAno, classificarDia, diasLetivos, contarLetivos, diaSemanaDe, ymd } from './regras.js';

const hoje = new Date();
const estado = {
  ano: hoje.getFullYear(),
  mes: hoje.getMonth() + 1,
  colegioId: null
};

function classeTipo(tipo) {
  if (tipo.startsWith('feriado')) return 'pill-feriado';
  if (tipo === 'ponto_facultativo' || tipo === 'recesso') return 'pill-nao-letivo';
  return 'pill-evento';
}

async function carregarDados(ano) {
  const [eventos, colegios, meta] = await Promise.all([
    listar('calendario_eventos', {
      select: '*, evento_colegios(colegio_id)',
      ordem: 'data',
      ajuste: (q) => q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`)
    }),
    listar('colegios', { ordem: 'nome' }),
    getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO)
  ]);
  const mapeados = eventos.map((e) => ({
    ...e,
    colegios: (e.evento_colegios || []).map((x) => x.colegio_id)
  }));
  return { eventos: mapeados, colegios, meta: Number(meta) };
}

function resumoAno(eventos, colegioId, ano) {
  const letivos = diasLetivos(diasDoAno(ano), eventos, colegioId).map((d) => d.data);
  return { total: letivos.length, porMes: contarLetivos(letivos) };
}

export async function telaCalendario(main) {
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Calendário letivo</h1>
        <p>Dias úteis são letivos, exceto feriados e eventos marcados como sem aula. Clique em um dia para ver ou adicionar um evento.</p>
      </div>
      <div class="acoes">
        <label class="campo"><span>Colégio</span><select id="cal-colegio"><option value="">Visão geral (eventos para todos)</option></select></label>
        <button class="btn azul" id="cal-importar" type="button">Importar feriados nacionais</button>
        <button class="btn primary" id="cal-novo" type="button">+ Evento</button>
      </div>
    </div>
    <div class="cal-controles" style="margin-bottom:16px">
      <button class="btn" id="cal-ant" type="button">‹ Anterior</button>
      <button class="btn" id="cal-ano-ant" type="button">‹ Ano</button>
      <span class="mes-titulo" id="cal-titulo"></span>
      <button class="btn" id="cal-ano-prox" type="button">Ano ›</button>
      <button class="btn" id="cal-prox" type="button">Próximo ›</button>
    </div>
    <div id="cal-kpis">${carregando()}</div>
    <div class="card" style="margin-top:16px">
      <div class="cal-grade" id="cal-grade"></div>
      <div class="cal-legenda">
        <span class="leg-letivo">Dia letivo</span>
        <span class="leg-feriado">Feriado</span>
        <span class="leg-evento">Evento ou ação</span>
        <span class="leg-nao">Sem aula (fim de semana, recesso ou ponto facultativo)</span>
      </div>
    </div>`;

  const selectColegio = main.querySelector('#cal-colegio');
  let dados = { eventos: [], colegios: [], meta: DIAS_LETIVOS_PADRAO };

  async function recarregar() {
    main.querySelector('#cal-titulo').textContent = `${MESES[estado.mes - 1]} de ${estado.ano}`;
    document.getElementById('cal-kpis').innerHTML = carregando();
    try {
      dados = await carregarDados(estado.ano);
      preencherColegios();
      desenhar();
    } catch (err) { mostrarErro(err); }
  }

  function preencherColegios() {
    const atual = selectColegio.value;
    selectColegio.innerHTML = '<option value="">Visão geral (eventos para todos)</option>' +
      dados.colegios.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    selectColegio.value = atual || (estado.colegioId || '');
  }

  function desenhar() {
    const colegioId = selectColegio.value || null;
    estado.colegioId = colegioId;
    const { eventos, meta } = dados;

    const datasMes = diasDoMes(estado.ano, estado.mes);
    const classes = datasMes.map((d) => classificarDia(d, eventos, colegioId));
    const letivosMes = classes.filter((c) => c.letivo).length;

    const anual = resumoAno(eventos, colegioId, estado.ano);
    const diferenca = anual.total - meta;
    const subAno = diferenca === 0 ? 'Meta atingida' : diferenca > 0 ? `${diferenca} acima da meta` : `faltam ${Math.abs(diferenca)} para a meta`;

    document.getElementById('cal-kpis').innerHTML = `
      <div class="grid kpis">
        <div class="card kpi"><div class="rotulo">Dias letivos no mês</div><div class="valor">${letivosMes}</div><div class="sub">${MESES[estado.mes - 1]}</div></div>
        <div class="card kpi azul"><div class="rotulo">Dias letivos no ano</div><div class="valor">${anual.total}</div><div class="sub">${estado.ano}</div></div>
        <div class="card kpi marinho"><div class="rotulo">Meta de dias letivos</div><div class="valor">${meta}</div><div class="sub">Editável em Configurações</div></div>
        <div class="card kpi ${diferenca === 0 ? 'verde' : ''}"><div class="rotulo">Situação do ano</div><div class="valor" style="font-size:20px;margin-top:12px">${esc(subAno)}</div></div>
      </div>`;

    const grade = document.getElementById('cal-grade');
    grade.innerHTML = DIAS_SEMANA.map((d) => `<div class="cal-dia-semana">${d}</div>`).join('');

    const inicio = diaSemanaDe(datasMes[0]);
    for (let i = 0; i < inicio; i++) grade.appendChild(el('<div class="cal-celula fora" aria-hidden="true"></div>'));

    const hojeTexto = ymd(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
    classes.forEach((c) => {
      const fds = c.util === false;
      const pills = [];
      c.eventos.forEach((e) => pills.push(`<span class="${classeTipo(e.tipo)}" title="${esc(e.nome)}">${esc(e.nome)}</span>`));
      if (c.letivo && !c.eventos.some((e) => e.dia_letivo)) pills.push('<span class="pill-letivo">Letivo</span>');
      else if (!c.letivo && !c.eventos.length) pills.push('<span class="pill-nao-letivo">Sem aula</span>');
      const celula = el(`
        <button type="button" class="cal-celula ${fds ? 'fds' : ''} ${c.data === hojeTexto ? 'hoje' : ''}" data-dia="${c.data}">
          <span class="cal-num">${Number(c.data.slice(8))}</span>
          ${pills.join('')}
        </button>`);
      celula.addEventListener('click', () => abrirDia(c.data));
      grade.appendChild(celula);
    });
  }

  function abrirDia(dataTexto) {
    const colegioId = selectColegio.value || null;
    const c = classificarDia(dataTexto, dados.eventos, colegioId);
    const doDia = dados.eventos.filter((e) => e.data === dataTexto);
    const [a, m, d] = dataTexto.split('-').map(Number);
    const diaNome = DIAS_SEMANA[diaSemanaDe(dataTexto)];

    const conteudo = document.createElement('div');
    conteudo.innerHTML = `
      <div class="aviso ${c.letivo ? 'verde' : ''}" style="margin-bottom:16px">
        <strong>${diaNome}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}:</strong>
        ${c.letivo ? 'dia letivo, com planejamento diário.' : 'sem aula. Não gera plano diário.'}
        ${colegioId ? `<br><span class="small">Considerando o colégio selecionado.</span>` : '<br><span class="small">Visão geral: só eventos para todos os colégios.</span>'}
      </div>
      <h3 style="margin-bottom:8px">Eventos neste dia</h3>
      <div class="dia-lista" id="dia-lista">
        ${doDia.length ? doDia.map((e) => {
          const nomesColegios = e.todos_colegios ? 'Todos os colégios' : (e.colegios || []).map((id) => dados.colegios.find((x) => x.id === id)?.nome).filter(Boolean).join(', ') || '—';
          return `
          <div class="dia-item">
            <div>
              <strong>${esc(e.nome)}</strong>
              <div class="small muted">${esc(TIPOS_EVENTO[e.tipo] || e.tipo)} · ${e.dia_letivo ? 'com aula' : 'sem aula'} · ${esc(nomesColegios)} ${e.origem === 'brasilapi' ? '· importado' : ''}</div>
            </div>
            <button class="btn pequeno perigo" type="button" data-apagar="${e.id}">Excluir</button>
          </div>`;
        }).join('') : '<p class="muted">Nenhum evento cadastrado para este dia.</p>'}
      </div>
      <div class="separador"></div>
      <h3 style="margin-bottom:12px">Adicionar evento</h3>`;

    const f = formulario([
      { k: 'nome', label: 'Nome do evento', type: 'text', req: true, largo: true, placeholder: 'Ex.: Reunião pedagógica, Feira de ciências' },
      { k: 'tipo', label: 'Tipo', type: 'select', req: true, opcoes: Object.entries(TIPOS_EVENTO), vazio: null },
      { k: 'dia_letivo', label: 'Tem aula neste dia (gera planejamento diário)', type: 'bool' },
      { k: 'todos_colegios', label: 'Vale para todos os colégios', type: 'bool' },
      { k: 'colegios', label: 'Colégios em que vale (se não for todos)', type: 'checks', largo: true, opcoes: dados.colegios.map((x) => [x.id, x.nome]) }
    ], { tipo: 'evento_colegio', todos_colegios: true, colegios: colegioId ? [colegioId] : [] });
    conteudo.appendChild(f.el);

    conteudo.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-apagar]');
      if (!btn) return;
      if (!window.confirm('Excluir este evento?')) return;
      try {
        await excluir('calendario_eventos', btn.dataset.apagar);
        toast('Evento excluído.', 'ok');
        fecharModal();
        recarregar();
      } catch (err) { mostrarErro(err); }
    });

    abrirModal({
      titulo: 'Dia ' + `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`,
      conteudo,
      submitLabel: 'Adicionar evento',
      onSubmit: async (fechar) => {
        const v = f.ler();
        if (!v.nome) throw new Error('Informe o nome do evento.');
        if (!v.todos_colegios && !v.colegios.length) throw new Error('Escolha pelo menos um colégio ou marque "vale para todos".');
        const [novo] = await inserir('calendario_eventos', {
          data: dataTexto,
          nome: v.nome,
          tipo: v.tipo,
          dia_letivo: v.dia_letivo,
          todos_colegios: v.todos_colegios,
          origem: 'manual'
        });
        if (!v.todos_colegios) {
          await supabase.from('evento_colegios').insert(v.colegios.map((colegio_id) => ({ evento_id: novo.id, colegio_id })));
        }
        fechar();
        toast('Evento adicionado.', 'ok');
        recarregar();
      }
    });
  }

  async function importarFeriados() {
    const ano = estado.ano;
    if (!window.confirm(`Importar os feriados nacionais de ${ano}? Os feriados importados antes deste ano serão substituídos. Eventos cadastrados manualmente não são alterados.`)) return;
    try {
      const resposta = await fetch(`${URL_FERIADOS}${ano}`);
      if (!resposta.ok) throw new Error(`A BrasilAPI respondeu com erro ${resposta.status}. Tente novamente.`);
      const feriados = await resposta.json();
      await supabase.from('calendario_eventos').delete().eq('origem', 'brasilapi').gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
      await inserir('calendario_eventos', feriados.map((f) => ({
        data: f.date,
        nome: f.name,
        tipo: 'feriado_nacional',
        dia_letivo: false,
        todos_colegios: true,
        origem: 'brasilapi'
      })));
      toast(`${feriados.length} feriados nacionais importados para ${ano}.`, 'ok');
      recarregar();
    } catch (err) { mostrarErro(err); }
  }

  main.querySelector('#cal-ant').onclick = () => { estado.mes--; if (estado.mes < 1) { estado.mes = 12; estado.ano--; } recarregar(); };
  main.querySelector('#cal-prox').onclick = () => { estado.mes++; if (estado.mes > 12) { estado.mes = 1; estado.ano++; } recarregar(); };
  main.querySelector('#cal-ano-ant').onclick = () => { estado.ano--; recarregar(); };
  main.querySelector('#cal-ano-prox').onclick = () => { estado.ano++; recarregar(); };
  main.querySelector('#cal-importar').onclick = importarFeriados;
  main.querySelector('#cal-novo').onclick = () => abrirDia(ymd(estado.ano, estado.mes, Math.min(hoje.getDate(), 28)));
  selectColegio.onchange = desenhar;

  recarregar();
}
