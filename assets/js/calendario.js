import { supabase } from './supabase.js';
import { listar, inserir, inserirVarios, excluir, atualizar, getConfig } from './db.js';
import { esc, el, abrirModal, fecharModal, formulario, toast, mostrarErro, carregando, fmtData } from './ui.js';
import { MESES, DIAS_SEMANA, TIPOS_EVENTO, DIAS_LETIVOS_PADRAO, URL_FERIADOS } from './config.js';
import { diasDoMes, diasDoAno, classificarDia, diasLetivos, contarLetivos, diaSemanaDe, ymd, ehDiaUtil, emendasDoAno } from './regras.js';

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

function intervaloDias(de, ate) {
  const out = [];
  const fim = new Date(ate + 'T00:00:00Z');
  for (let d = new Date(de + 'T00:00:00Z'); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function carregarDados(ano) {
  const [eventos, colegios, catalogo, meta] = await Promise.all([
    listar('calendario_eventos', {
      select: '*, evento_colegios(colegio_id)',
      ordem: 'data',
      ajuste: (q) => q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`)
    }),
    listar('colegios', { ordem: 'nome', ajuste: (q) => q.eq('ano', ano) }),
    listar('eventos_catalogo', { ordem: 'nome' }),
    getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO)
  ]);
  return {
    eventos: eventos.map((e) => ({ ...e, colegios: (e.evento_colegios || []).map((x) => x.colegio_id) })),
    colegios,
    catalogo,
    meta: Number(meta)
  };
}

function contagensDoPeriodo(datas, eventos, colegioId, ano) {
  const { feriados, emendas } = emendasDoAno(ano, eventos, colegioId);
  const conta = { nacional: 0, feriadoEmenda: 0, pedagogica: 0, extra: 0 };
  for (const d of datas) {
    const c = classificarDia(d, eventos, colegioId);
    if (c.eventos.some((e) => e.tipo === 'feriado_nacional')) conta.nacional++;
    if (feriados.has(d) || emendas.has(d)) conta.feriadoEmenda++;
    if (c.eventos.some((e) => e.tipo === 'acao_pedagogica')) conta.pedagogica++;
    if (c.eventos.some((e) => e.tipo === 'evento_colegio')) conta.extra++;
  }
  return conta;
}

export async function telaCalendario(main) {
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Calendário letivo</h1>
        <p>Dias úteis são letivos, exceto feriados e eventos marcados como sem aula. Os eventos vêm do catálogo "Eventos cadastrados", abaixo do calendário.</p>
      </div>
      <div class="acoes" style="align-items:flex-end">
        <button class="btn azul" id="cal-importar" type="button">Importar feriados nacionais</button>
        <button class="btn primary" id="cal-novo" type="button">+ Evento</button>
        <label class="campo"><span>Colégio</span><select id="cal-colegio"></select></label>
      </div>
    </div>

    <div class="cal-nav">
      <button class="btn pequeno" id="cal-ano-ant" type="button">‹ Ano</button>
      <button class="btn" id="cal-ant" type="button">‹ Mês</button>
      <span class="mes-titulo" id="cal-titulo"></span>
      <button class="btn" id="cal-prox" type="button">Mês ›</button>
      <button class="btn pequeno" id="cal-ano-prox" type="button">Ano ›</button>
    </div>

    <div id="cal-kpis">${carregando()}</div>

    <div class="card">
      <div class="cal-topo">
        <button class="btn" id="cal-modo" type="button">Selecionar dias</button>
        <span class="small muted">Use para marcar vários dias e aplicar um evento de uma vez.</span>
      </div>
      <div class="faixa" id="cal-barra" style="margin-bottom:14px" hidden></div>
      <div class="cal-grade" id="cal-grade"></div>
      <div class="cal-legenda">
        <span class="leg-letivo">Dia letivo</span>
        <span class="leg-feriado">Feriado</span>
        <span class="leg-evento">Evento ou ação</span>
        <span class="leg-nao">Sem aula (fim de semana, recesso ou ponto facultativo)</span>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <h3 id="lanc-titulo" style="margin-bottom:12px"></h3>
      <div id="lanc-lista"></div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="cal-topo" style="justify-content:space-between">
        <div>
          <h3>Eventos cadastrados</h3>
          <p class="small muted" style="margin:0">Catálogo usado nos lançamentos. Cadastre uma vez e reutilize em qualquer dia.</p>
        </div>
        <button class="btn primary" id="cat-novo" type="button">+ Novo evento cadastrado</button>
      </div>
      <div id="cat-lista" style="margin-top:14px"></div>
    </div>`;

  const selectColegio = main.querySelector('#cal-colegio');
  let dados = { eventos: [], colegios: [], catalogo: [], meta: DIAS_LETIVOS_PADRAO };
  const selecao = new Set();
  let modoSelecao = false;

  async function recarregar() {
    main.querySelector('#cal-titulo').textContent = `${MESES[estado.mes - 1]} de ${estado.ano}`;
    try {
      dados = await carregarDados(estado.ano);
      const atual = selectColegio.value || estado.colegioId || '';
      selectColegio.innerHTML = '<option value="">Visão geral (eventos para todos)</option>' +
        dados.colegios.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
      selectColegio.value = atual;
      desenhar();
      renderLancamentos();
      renderCatalogo();
    } catch (err) { mostrarErro(err); }
  }

  function colegioAtual() {
    return selectColegio.value || null;
  }

  function desenhar() {
    const colegioId = colegioAtual();
    estado.colegioId = colegioId;
    const { eventos, meta } = dados;
    const ano = estado.ano;

    const datasMes = diasDoMes(ano, estado.mes);
    const classes = datasMes.map((d) => classificarDia(d, eventos, colegioId));
    const letivosMes = classes.filter((c) => c.letivo).length;
    const letivosAno = diasLetivos(diasDoAno(ano), eventos, colegioId).map((d) => d.data);
    const totalAno = letivosAno.length;
    const diferenca = totalAno - meta;
    const subAno = diferenca === 0 ? 'Meta atingida' : diferenca > 0 ? `${diferenca} acima da meta` : `faltam ${Math.abs(diferenca)} para a meta`;

    const cMes = contagensDoPeriodo(datasMes, eventos, colegioId, ano);
    const cAno = contagensDoPeriodo(diasDoAno(ano), eventos, colegioId, ano);

    document.getElementById('cal-kpis').innerHTML = `
      <div class="grid kpis" style="margin-bottom:16px">
        <div class="card kpi"><div class="rotulo">Dias letivos no mês</div><div class="valor">${letivosMes}</div><div class="sub">${MESES[estado.mes - 1]}</div></div>
        <div class="card kpi azul"><div class="rotulo">Dias letivos no ano</div><div class="valor">${totalAno}</div><div class="sub">${ano}</div></div>
        <div class="card kpi marinho"><div class="rotulo">Meta de dias letivos</div><div class="valor">${meta}</div><div class="sub">Editável em Configurações</div></div>
        <div class="card kpi ${diferenca === 0 ? 'verde' : ''}"><div class="rotulo">Situação do ano</div><div class="valor" style="font-size:20px;margin-top:12px">${esc(subAno)}</div></div>
      </div>
      <div class="grid kpis" style="margin-bottom:16px">
        <div class="card kpi"><div class="rotulo">Feriados nacionais</div><div class="valor">${cMes.nacional}</div><div class="sub">no ano: ${cAno.nacional}</div></div>
        <div class="card kpi"><div class="rotulo">Feriados + emendas</div><div class="valor">${cMes.feriadoEmenda}</div><div class="sub">no ano: ${cAno.feriadoEmenda}</div></div>
        <div class="card kpi azul"><div class="rotulo">Atividades pedagógicas</div><div class="valor">${cMes.pedagogica}</div><div class="sub">no ano: ${cAno.pedagogica}</div></div>
        <div class="card kpi laranja"><div class="rotulo">Eventos curriculares extras</div><div class="valor">${cMes.extra}</div><div class="sub">no ano: ${cAno.extra}</div></div>
      </div>`;

    const grade = document.getElementById('cal-grade');
    grade.classList.toggle('modo-selecao', modoSelecao);
    grade.innerHTML = DIAS_SEMANA.map((d) => `<div class="cal-dia-semana">${d}</div>`).join('');
    const inicio = diaSemanaDe(datasMes[0]);
    for (let i = 0; i < inicio; i++) grade.appendChild(el('<div class="cal-celula fora" aria-hidden="true"></div>'));

    const hojeTexto = ymd(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
    classes.forEach((c) => {
      const fds = c.util === false;
      const pills = c.eventos.map((e) => `<span class="${classeTipo(e.tipo)}" title="${esc(e.nome)}">${esc(e.nome)}</span>`);
      if (c.letivo && !c.eventos.some((e) => e.dia_letivo)) pills.push('<span class="pill-letivo">Letivo</span>');
      else if (!c.letivo && !c.eventos.length) pills.push('<span class="pill-nao-letivo">Sem aula</span>');
      const celula = el(`
        <button type="button" class="cal-celula ${fds ? 'fds' : ''} ${c.data === hojeTexto ? 'hoje' : ''} ${selecao.has(c.data) ? 'selecionado' : ''}" data-dia="${c.data}">
          <span class="cal-num">${Number(c.data.slice(8))}</span>
          ${pills.join('')}
        </button>`);
      celula.addEventListener('click', () => {
        if (!modoSelecao) return abrirDia(c.data);
        if (selecao.has(c.data)) selecao.delete(c.data);
        else selecao.add(c.data);
        desenhar();
        renderBarra();
      });
      grade.appendChild(celula);
    });
  }

  function renderBarra() {
    const barra = document.getElementById('cal-barra');
    const n = selecao.size;
    barra.hidden = !(modoSelecao || n);
    barra.innerHTML = `
      <div>
        <strong>${n} dia(s) selecionado(s)</strong>
        <span class="small">${modoSelecao ? ' · clique nos dias para marcar ou desmarcar. A seleção continua ao trocar de mês.' : ''}</span>
      </div>
      <div class="acoes">
        <button class="btn pequeno" data-sel="periodo" type="button">Selecionar período</button>
        <button class="btn pequeno" data-sel="mes" type="button">Selecionar mês inteiro</button>
        <button class="btn pequeno primary" data-sel="aplicar" type="button" ${n ? '' : 'disabled'}>Aplicar evento</button>
        <button class="btn pequeno perigo" data-sel="remover" type="button" ${n ? '' : 'disabled'}>Remover eventos manuais</button>
        <button class="btn pequeno" data-sel="limpar" type="button" ${n ? '' : 'disabled'}>Limpar</button>
      </div>`;
  }

  function renderLancamentos() {
    const prefixo = `${estado.ano}-${String(estado.mes).padStart(2, '0')}`;
    const colegioId = colegioAtual();
    const lista = dados.eventos.filter((e) => e.data.startsWith(prefixo));
    main.querySelector('#lanc-titulo').textContent = `Lançamentos de ${MESES[estado.mes - 1]} (${lista.length})`;
    const area = main.querySelector('#lanc-lista');
    if (!lista.length) {
      area.innerHTML = '<div class="vazio">Nenhum evento lançado neste mês. Feriados importados aparecem aqui.</div>';
      return;
    }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Data</th><th>Evento</th><th>Tipo</th><th>Aula</th><th>Colégios</th><th>Origem</th><th></th></tr></thead>
        <tbody>${lista.map((e) => {
          const nomes = e.todos_colegios ? 'Todos' : (e.colegios || []).map((id) => dados.colegios.find((c) => c.id === id)?.nome).filter(Boolean).join(', ') || '—';
          const naVisao = !colegioId || e.todos_colegios || e.colegios.includes(colegioId);
          return `<tr style="${naVisao ? '' : 'opacity:.5'}">
            <td>${fmtData(e.data)}</td>
            <td><strong>${esc(e.nome)}</strong></td>
            <td><span class="${classeTipo(e.tipo)}" style="display:inline-block">${esc(TIPOS_EVENTO[e.tipo] || e.tipo)}</span></td>
            <td>${e.dia_letivo ? '<span class="tag verde">com aula</span>' : '<span class="tag">sem aula</span>'}</td>
            <td>${esc(nomes)}</td>
            <td>${e.origem === 'brasilapi' ? '<span class="tag azul">importado</span>' : '<span class="tag">manual</span>'}</td>
            <td class="acoes-linha"><button class="btn pequeno perigo" data-lanc-excluir="${e.id}" type="button">Excluir</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    area.onclick = async (ev) => {
      const b = ev.target.closest('[data-lanc-excluir]');
      if (!b) return;
      if (!window.confirm('Excluir este lançamento?')) return;
      try {
        await excluir('calendario_eventos', b.dataset.lancExcluir);
        toast('Lançamento excluído.', 'ok');
        recarregar();
      } catch (err) { mostrarErro(err); }
    };
  }

  function renderCatalogo() {
    const area = main.querySelector('#cat-lista');
    const usos = {};
    dados.eventos.forEach((e) => { if (e.catalogo_id) usos[e.catalogo_id] = (usos[e.catalogo_id] || 0) + 1; });
    if (!dados.catalogo.length) {
      area.innerHTML = '<div class="vazio">Nenhum evento cadastrado. Clique em "+ Novo evento cadastrado" para criar o primeiro.</div>';
      return;
    }
    area.innerHTML = `
      <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Aula</th><th>Situação</th><th>Usos no ano</th><th></th></tr></thead>
        <tbody>${dados.catalogo.map((c) => `
          <tr>
            <td><strong>${esc(c.nome)}</strong></td>
            <td><span class="${classeTipo(c.tipo)}" style="display:inline-block">${esc(TIPOS_EVENTO[c.tipo] || c.tipo)}</span></td>
            <td>${c.dia_letivo ? '<span class="tag verde">com aula</span>' : '<span class="tag">sem aula</span>'}</td>
            <td>${c.ativo ? '<span class="tag verde">ativo</span>' : '<span class="tag">inativo</span>'}</td>
            <td>${usos[c.id] || 0}</td>
            <td class="acoes-linha">
              <button class="btn pequeno" data-cat-editar="${c.id}" type="button">Editar</button>
              <button class="btn pequeno perigo" data-cat-excluir="${c.id}" type="button">Excluir</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`;
    area.onclick = (ev) => {
      const ed = ev.target.closest('[data-cat-editar]');
      const ex = ev.target.closest('[data-cat-excluir]');
      if (ed) abrirFormCatalogo(dados.catalogo.find((c) => c.id === ed.dataset.catEditar));
      if (ex) excluirCatalogo(dados.catalogo.find((c) => c.id === ex.dataset.catExcluir));
    };
  }

  function abrirFormCatalogo(item) {
    const f = formulario([
      { k: 'nome', label: 'Nome do evento', type: 'text', req: true, largo: true, placeholder: 'Ex.: Recesso escolar, Feira de ciências' },
      { k: 'tipo', label: 'Tipo', type: 'select', req: true, opcoes: Object.entries(TIPOS_EVENTO), vazio: null },
      { k: 'dia_letivo', label: 'Tem aula neste evento (gera planejamento diário)', type: 'bool' },
      { k: 'ativo', label: 'Disponível para lançar', type: 'bool' }
    ], item || { tipo: 'evento_colegio', dia_letivo: false, ativo: true });
    abrirModal({
      titulo: item ? 'Editar evento cadastrado' : 'Novo evento cadastrado',
      conteudo: f.el,
      onSubmit: async (fechar) => {
        const v = f.ler();
        if (!v.nome) throw new Error('Informe o nome do evento.');
        if (!v.tipo) throw new Error('Escolha o tipo.');
        if (item) await atualizar('eventos_catalogo', item.id, v);
        else await inserir('eventos_catalogo', v);
        fechar();
        toast('Evento salvo no catálogo.', 'ok');
        recarregar();
      }
    });
  }

  async function excluirCatalogo(item) {
    if (!window.confirm(`Excluir "${item.nome}" do catálogo? Os lançamentos já feitos continuam no calendário, sem vínculo com o catálogo.`)) return;
    try {
      await excluir('eventos_catalogo', item.id);
      toast('Evento removido do catálogo.', 'ok');
      recarregar();
    } catch (err) { mostrarErro(err); }
  }

  // Cria lançamentos a partir de um evento do catálogo, em uma lista de datas.
  async function criarLancamentos(datas, v) {
    const item = dados.catalogo.find((c) => c.id === v.catalogo_id);
    if (!item) throw new Error('Escolha um evento cadastrado.');
    if (!datas.length) throw new Error('Nenhuma data escolhida.');
    if (!v.todos_colegios && !v.colegios.length) throw new Error('Escolha pelo menos um colégio ou marque "vale para todos".');
    const criados = await inserirVarios('calendario_eventos', datas.map((d) => ({
      data: d,
      nome: item.nome,
      tipo: item.tipo,
      dia_letivo: item.dia_letivo,
      todos_colegios: v.todos_colegios,
      origem: 'manual',
      catalogo_id: item.id
    })));
    if (!v.todos_colegios) {
      const vinculos = criados.flatMap((e) => v.colegios.map((colegio_id) => ({ evento_id: e.id, colegio_id })));
      const { error } = await supabase.from('evento_colegios').insert(vinculos);
      if (error) throw error;
    }
    return criados.length;
  }

  // Formulário de lançamento. Com `datas` fixas (seleção ou dia), ou com período (botão "+ Evento").
  function abrirFormLancamento({ datas = null, titulo }) {
    const campos = [
      { k: 'catalogo_id', label: 'Evento cadastrado', type: 'select', req: true, largo: true, opcoes: dados.catalogo.filter((c) => c.ativo).map((c) => [c.id, `${c.nome} · ${TIPOS_EVENTO[c.tipo] || c.tipo}${c.dia_letivo ? ' (com aula)' : ''}`]), vazio: 'Escolha um evento' },
      { k: 'todos_colegios', label: 'Vale para todos os colégios', type: 'bool' },
      { k: 'colegios', label: 'Colégios em que vale (se não for todos)', type: 'checks', largo: true, opcoes: dados.colegios.map((x) => [x.id, x.nome]) }
    ];
    if (!datas) {
      campos.splice(1, 0,
        { k: 'de', label: 'Data inicial', type: 'date', req: true },
        { k: 'ate', label: 'Data final (igual à inicial para um dia)', type: 'date', req: true },
        { k: 'uteis', label: 'Somente dias úteis', type: 'bool' });
    }
    const f = formulario(campos, { todos_colegios: true, colegios: colegioAtual() ? [colegioAtual()] : [], uteis: true, de: `${estado.ano}-${String(estado.mes).padStart(2, '0')}-01`, ate: `${estado.ano}-${String(estado.mes).padStart(2, '0')}-01` });
    const conteudo = document.createElement('div');
    if (datas) {
      const dias = [...datas].sort();
      conteudo.innerHTML = `<div class="aviso" style="margin-bottom:14px"><strong>${dias.length} dia(s)</strong>, de ${fmtData(dias[0])} a ${fmtData(dias.at(-1))}.</div>`;
    }
    if (!dados.catalogo.length) {
      conteudo.appendChild(el('<div class="aviso" style="margin-bottom:14px">Nenhum evento cadastrado ainda. Cadastre em "Eventos cadastrados", abaixo do calendário.</div>'));
    }
    conteudo.appendChild(f.el);
    abrirModal({
      titulo,
      conteudo,
      submitLabel: datas ? `Aplicar a ${datas.length} dia(s)` : 'Lançar evento',
      onSubmit: async (fechar) => {
        const v = f.ler();
        let dias = datas;
        if (!dias) {
          if (!v.de || !v.ate) throw new Error('Informe as datas.');
          if (v.de > v.ate) throw new Error('A data inicial é posterior à final.');
          dias = intervaloDias(v.de, v.ate);
          if (v.uteis) dias = dias.filter(ehDiaUtil);
        }
        const n = await criarLancamentos(dias, v);
        selecao.clear();
        modoSelecao = false;
        fechar();
        toast(`${n} lançamento(s) criado(s).`, 'ok');
        recarregar();
      }
    });
  }

  function abrirDia(dataTexto) {
    const colegioId = colegioAtual();
    const c = classificarDia(dataTexto, dados.eventos, colegioId);
    const doDia = dados.eventos.filter((e) => e.data === dataTexto);
    const [a, m, d] = dataTexto.split('-').map(Number);
    const diaNome = DIAS_SEMANA[diaSemanaDe(dataTexto)];

    const conteudo = document.createElement('div');
    conteudo.innerHTML = `
      <div class="aviso ${c.letivo ? 'verde' : ''}" style="margin-bottom:16px">
        <strong>${diaNome}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}:</strong>
        ${c.letivo ? 'dia letivo, com planejamento diário.' : 'sem aula. Não gera plano diário.'}
        <br><span class="small">${colegioId ? 'Considerando o colégio selecionado.' : 'Visão geral: só eventos para todos os colégios.'}</span>
      </div>
      <h3 style="margin-bottom:8px">Eventos neste dia</h3>
      <div class="dia-lista">
        ${doDia.length ? doDia.map((e) => `
          <div class="dia-item">
            <div>
              <strong>${esc(e.nome)}</strong>
              <div class="small muted">${esc(TIPOS_EVENTO[e.tipo] || e.tipo)} · ${e.dia_letivo ? 'com aula' : 'sem aula'} ${e.origem === 'brasilapi' ? '· importado' : ''}</div>
            </div>
            <button class="btn pequeno perigo" type="button" data-apagar="${e.id}">Excluir</button>
          </div>`).join('') : '<p class="muted">Nenhum evento cadastrado para este dia.</p>'}
      </div>`;
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

    const botaoNovo = el('<button type="button" class="btn azul" style="margin-top:12px">Lançar evento neste dia</button>');
    botaoNovo.onclick = () => abrirFormLancamento({ datas: [dataTexto], titulo: `Lançar evento · ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}` });
    conteudo.appendChild(botaoNovo);

    abrirModal({
      titulo: `Dia ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`,
      conteudo,
      submitLabel: 'Fechar',
      onSubmit: async (fechar) => fechar()
    });
  }

  async function importarFeriados() {
    const ano = estado.ano;
    if (!window.confirm(`Importar os feriados nacionais de ${ano}? Os feriados importados antes deste ano serão substituídos. Lançamentos manuais não são alterados.`)) return;
    try {
      const resposta = await fetch(`${URL_FERIADOS}${ano}`);
      if (!resposta.ok) throw new Error(`A BrasilAPI respondeu com erro ${resposta.status}. Tente novamente.`);
      const feriados = await resposta.json();
      const { error: erroApagar } = await supabase.from('calendario_eventos').delete().eq('origem', 'brasilapi').gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
      if (erroApagar) throw erroApagar;
      await inserirVarios('calendario_eventos', feriados.map((f) => ({
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

  main.querySelector('#cal-barra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    const acao = b.dataset.sel;
    if (acao === 'periodo') {
      const ultimo = diasDoMes(estado.ano, estado.mes).at(-1);
      const f = formulario([
        { k: 'de', label: 'Data inicial', type: 'date', req: true },
        { k: 'ate', label: 'Data final', type: 'date', req: true },
        { k: 'uteis', label: 'Somente dias úteis (segunda a sexta)', type: 'bool', largo: true }
      ], { de: `${estado.ano}-${String(estado.mes).padStart(2, '0')}-01`, ate: ultimo, uteis: true });
      const conteudo = document.createElement('div');
      conteudo.append(el('<p class="small muted" style="margin-bottom:14px">Os dias do período são somados à seleção atual. Use, por exemplo, para marcar o início e o fim do ano letivo.</p>'), f.el);
      abrirModal({
        titulo: 'Selecionar período',
        conteudo,
        submitLabel: 'Adicionar à seleção',
        onSubmit: async (fechar) => {
          const v = f.ler();
          if (!v.de || !v.ate) throw new Error('Informe as duas datas.');
          if (v.de > v.ate) throw new Error('A data inicial é posterior à final.');
          let dias = intervaloDias(v.de, v.ate);
          if (v.uteis) dias = dias.filter(ehDiaUtil);
          dias.forEach((d) => selecao.add(d));
          fechar();
          toast(`${dias.length} dia(s) adicionados à seleção.`, 'ok');
          desenhar();
          renderBarra();
        }
      });
    }
    if (acao === 'mes') { diasDoMes(estado.ano, estado.mes).forEach((d) => selecao.add(d)); desenhar(); renderBarra(); }
    if (acao === 'aplicar') abrirFormLancamento({ datas: [...selecao], titulo: 'Aplicar evento aos dias selecionados' });
    if (acao === 'remover') removerLoteManuais();
    if (acao === 'limpar') { selecao.clear(); desenhar(); renderBarra(); }
  });

  async function removerLoteManuais() {
    const dias = [...selecao];
    if (!window.confirm(`Remover os lançamentos manuais de ${dias.length} dia(s)? Feriados importados não são removidos.`)) return;
    try {
      const { error } = await supabase.from('calendario_eventos').delete().in('data', dias).eq('origem', 'manual');
      if (error) throw error;
      selecao.clear();
      toast('Lançamentos removidos.', 'ok');
      recarregar();
    } catch (err) { mostrarErro(err); }
  }

  main.querySelector('#cal-modo').onclick = () => {
    modoSelecao = !modoSelecao;
    const botao = main.querySelector('#cal-modo');
    botao.textContent = modoSelecao ? 'Sair do modo seleção' : 'Selecionar dias';
    botao.classList.toggle('primary', modoSelecao);
    desenhar();
    renderBarra();
  };

  main.querySelector('#cal-ant').onclick = () => { estado.mes--; if (estado.mes < 1) { estado.mes = 12; estado.ano--; } recarregar(); };
  main.querySelector('#cal-prox').onclick = () => { estado.mes++; if (estado.mes > 12) { estado.mes = 1; estado.ano++; } recarregar(); };
  main.querySelector('#cal-ano-ant').onclick = () => { estado.ano--; recarregar(); };
  main.querySelector('#cal-ano-prox').onclick = () => { estado.ano++; recarregar(); };
  main.querySelector('#cal-importar').onclick = importarFeriados;
  main.querySelector('#cal-novo').onclick = () => abrirFormLancamento({ titulo: 'Lançar evento' });
  main.querySelector('#cat-novo').onclick = () => abrirFormCatalogo(null);
  selectColegio.onchange = () => { desenhar(); renderLancamentos(); };

  renderBarra();
  recarregar();
}
