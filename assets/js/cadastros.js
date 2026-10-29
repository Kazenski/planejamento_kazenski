import { listar, inserir, inserirVarios, atualizar, excluir } from './db.js';
import { esc, abrirModal, formulario, mostrarErro, toast, carregando, lista } from './ui.js';
import { SERIES } from './config.js';

const anoAtual = new Date().getFullYear();

// Cada cadastro descreve: como listar, colunas, campos do formulário e textos.
const CADASTROS = {
  colegios: {
    titulo: 'Colégios',
    singular: 'colégio',
    descricao: 'Direção, coordenação, supervisão e e-mails usados nos envios de planejamento.',
    tabela: 'colegios',
    ordem: 'nome',
    filtroAno: true,
    copiar: true,
    listar: (ano) => listar('colegios', { ordem: 'nome', ajuste: (q) => (ano ? q.eq('ano', ano) : q) }),
    colunas: [
      { label: 'Colégio', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Direção', valor: (i) => esc(i.direcao || '—') },
      { label: 'Coordenação', valor: (i) => esc(i.coordenacao || '—') },
      { label: 'Supervisão', valor: (i) => esc(i.supervisao || '—') },
      { label: 'Em cópia', valor: (i) => lista(i.emails_copia) },
      { label: 'Envio de material', valor: (i) => lista(i.emails_material) }
    ],
    campos: async () => [
      { k: 'nome', label: 'Nome do colégio', type: 'text', req: true, largo: true },
      { k: 'direcao', label: 'Direção', type: 'text' },
      { k: 'coordenacao', label: 'Coordenação', type: 'text' },
      { k: 'supervisao', label: 'Supervisão', type: 'text' },
      { k: 'emails_copia', label: 'E-mails em cópia', type: 'lista', ajuda: 'Um por linha ou separados por vírgula.' },
      { k: 'emails_material', label: 'E-mails para envio de material pedagógico', type: 'lista', ajuda: 'Um por linha ou separados por vírgula.' },
      { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
      { k: 'ativo', label: 'Colégio ativo', type: 'bool' }
    ]
  },

  disciplinas: {
    titulo: 'Disciplinas',
    singular: 'disciplina',
    descricao: 'Componentes curriculares do técnico em TI. Depois vincule às turmas com a quantidade de aulas por semana.',
    tabela: 'disciplinas',
    ordem: 'nome',
    filtroAno: true,
    copiar: true,
    listar: (ano) => listar('disciplinas', { ordem: 'nome', ajuste: (q) => (ano ? q.eq('ano', ano) : q) }),
    colunas: [
      { label: 'Disciplina', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Situação', valor: (i) => (i.ativo ? '<span class="tag verde">Ativa</span>' : '<span class="tag">Inativa</span>') }
    ],
    campos: async () => [
      { k: 'nome', label: 'Nome da disciplina', type: 'text', req: true, largo: true },
      { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
      { k: 'ativo', label: 'Disciplina ativa', type: 'bool' }
    ]
  },

  turmas: {
    titulo: 'Turmas',
    singular: 'turma',
    descricao: 'Turmas por colégio e ano letivo. A quantidade de alunos aparece só no cabeçalho do planejamento.',
    tabela: 'turmas',
    ordem: 'nome',
    filtroAno: true,
    listar: (ano) => listar('turmas', {
      select: '*, colegios(nome)',
      ordem: 'nome',
      ajuste: (q) => (ano ? q.eq('ano', ano) : q)
    }),
    colunas: [
      { label: 'Colégio', valor: (i) => esc(i.colegios?.nome || '—') },
      { label: 'Turma', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Série', valor: (i) => esc(SERIES[i.serie] || i.serie) },
      { label: 'Curso', valor: (i) => esc(i.curso) },
      { label: 'Ano', valor: (i) => esc(i.ano) },
      { label: 'Alunos', valor: (i) => esc(i.qtd_alunos ?? '—') }
    ],
    campos: async () => {
      const colegios = await listar('colegios', { ordem: 'nome' });
      return [
        { k: 'colegio_id', label: 'Colégio', type: 'select', req: true, opcoes: colegios.map((c) => [c.id, `${c.nome} (${c.ano})`]), vazio: 'Escolha o colégio' },
        { k: 'nome', label: 'Nome da turma', type: 'text', req: true, placeholder: 'Ex.: 1º A' },
        { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
        { k: 'serie', label: 'Série', type: 'select', req: true, opcoes: Object.entries(SERIES).map(([v, r]) => [v, r]) },
        { k: 'curso', label: 'Curso', type: 'text', req: true },
        { k: 'qtd_alunos', label: 'Quantidade de alunos', type: 'number', min: 0, step: 1 },
        { k: 'observacoes', label: 'Particularidades da turma', type: 'textarea', largo: true, placeholder: 'Ex.: turma com muitos alunos de primeiro ano, laboratório com 20 máquinas, aluno com acompanhamento especial' },
        { k: 'ativo', label: 'Turma ativa', type: 'bool' }
      ];
    }
  },

  aulas: {
    titulo: 'Aulas por disciplina',
    singular: 'vínculo',
    descricao: 'Quantas aulas por semana cada disciplina tem em cada turma. Esse número define a distribuição dos planos diários.',
    tabela: 'turma_disciplinas',
    ordem: 'aulas_semana',
    filtroAno: true,
    listar: (ano) => listar('turma_disciplinas', {
      select: '*, turmas!inner(nome, ano, colegios(nome)), disciplinas(nome)',
      ordem: null,
      ajuste: (q) => (ano ? q.eq('turmas.ano', ano) : q)
    }),
    colunas: [
      { label: 'Colégio', valor: (i) => esc(i.turmas?.colegios?.nome || '—') },
      { label: 'Turma', valor: (i) => esc(`${i.turmas?.nome || ''} (${i.turmas?.ano || ''})`) },
      { label: 'Disciplina', valor: (i) => `<strong>${esc(i.disciplinas?.nome || '—')}</strong>` },
      { label: 'Aulas por semana', valor: (i) => `<span class="tag laranja">${esc(i.aulas_semana)}</span>` }
    ],
    campos: async (ctx) => {
      const turmas = await listar('turmas', { select: '*, colegios(nome)', ordem: 'nome', ajuste: (q) => (ctx.ano ? q.eq('ano', ctx.ano) : q) });
      const disciplinas = await listar('disciplinas', { ordem: 'nome' });
      return [
        { k: 'turma_id', label: 'Turma', type: 'select', req: true, opcoes: turmas.map((t) => [t.id, `${t.colegios?.nome || ''} · ${t.nome} (${t.ano})`]), vazio: 'Escolha a turma' },
        { k: 'disciplina_id', label: 'Disciplina', type: 'select', req: true, opcoes: disciplinas.map((d) => [d.id, `${d.nome} (${d.ano})`]), vazio: 'Escolha a disciplina' },
        { k: 'aulas_semana', label: 'Aulas por semana', type: 'number', req: true, min: 1, max: 12, step: 1, ajuda: 'Exemplo: 2 aulas de 50 minutos por semana.' }
      ];
    }
  }
};

export async function telaCadastro(main, chave) {
  const cfg = CADASTROS[chave];
  if (!cfg) { main.innerHTML = '<p class="vazio">Cadastro não encontrado.</p>'; return; }
  const ctx = { ano: cfg.filtroAno ? anoAtual : null };
  let dadosAtuais = [];

  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>${esc(cfg.titulo)}</h1>
        <p>${esc(cfg.descricao)}</p>
      </div>
      <div class="acoes">
        ${cfg.filtroAno ? `
          <label class="campo"><span>Ano letivo</span>
            <select id="filtro-ano">
              ${[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('')}
              <option value="">Todos</option>
            </select>
          </label>` : ''}
        ${cfg.copiar ? '<button class="btn" id="btn-copiar" type="button">Copiar do ano anterior</button>' : ''}
        <button class="btn primary" id="btn-novo" type="button">+ Novo ${esc(cfg.singular)}</button>
      </div>
    </div>
    <div id="area-lista">${carregando()}</div>`;

  async function carregarLista() {
    const area = document.getElementById('area-lista');
    area.innerHTML = carregando();
    try {
      const dados = await cfg.listar(ctx.ano);
      dadosAtuais = dados;
      area.innerHTML = dados.length ? `
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr>${cfg.colunas.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${dados.map((i) => `
              <tr data-id="${i.id}">
                ${cfg.colunas.map((c) => `<td>${c.valor(i)}</td>`).join('')}
                <td class="acoes-linha">
                  <button class="btn pequeno" data-editar="${i.id}" type="button">Editar</button>
                  <button class="btn pequeno perigo" data-excluir="${i.id}" type="button">Excluir</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="tabela-wrap"><div class="vazio">Nada cadastrado ainda. Clique em "+ Novo ${esc(cfg.singular)}".</div></div>`;
    } catch (err) {
      mostrarErro(err);
      area.innerHTML = '<div class="aviso">Não foi possível carregar. Tente novamente.</div>';
    }
  }

  async function abrirForm(item) {
    const campos = await cfg.campos(ctx);
    const valores = item ? { ...item } : { ano: ctx.ano || anoAtual, ativo: true, curso: 'Técnico em Informática', serie: 1 };
    if (item && chave === 'turmas') valores.colegio_id = item.colegio_id;
    if (item && chave === 'aulas') {
      valores.turma_id = item.turma_id;
      valores.disciplina_id = item.disciplina_id;
    }
    const f = formulario(campos, valores);
    abrirModal({
      titulo: item ? `Editar ${cfg.singular}` : `Novo ${cfg.singular}`,
      conteudo: f.el,
      onSubmit: async (fechar) => {
        const dados = f.ler();
        for (const k of Object.keys(dados)) if (dados[k] === null && k !== 'emails_copia' && k !== 'emails_material') delete dados[k];
        if (chave === 'colegios') {
          dados.emails_copia = dados.emails_copia || [];
          dados.emails_material = dados.emails_material || [];
        }
        if (chave === 'turmas' && dados.serie) dados.serie = Number(dados.serie);
        if (item) await atualizar(cfg.tabela, item.id, dados);
        else await inserir(cfg.tabela, dados);
        fechar();
        toast('Salvo com sucesso.', 'ok');
        carregarLista();
      }
    });
  }

  main.querySelector('#btn-novo').addEventListener('click', () => abrirForm(null).catch(mostrarErro));

  // Copia para o ano escolhido os cadastros do ano anterior que ainda não existem nele.
  async function copiarAnoAnterior() {
    try {
      if (!ctx.ano) return toast('Escolha um ano específico no filtro para copiar.', 'erro');
      const origem = await listar(cfg.tabela, { ordem: 'nome', ajuste: (q) => q.eq('ano', ctx.ano - 1) });
      if (!origem.length) return toast(`Não há cadastros em ${ctx.ano - 1} para copiar.`, 'erro');
      const atuais = await listar(cfg.tabela, { ordem: null, ajuste: (q) => q.eq('ano', ctx.ano) });
      const nomes = new Set(atuais.map((x) => x.nome.toLowerCase()));
      const novos = origem
        .filter((x) => !nomes.has(x.nome.toLowerCase()))
        .map((x) => ({
          nome: x.nome,
          ativo: x.ativo,
          ano: ctx.ano,
          ...(chave === 'colegios' ? {
            direcao: x.direcao, coordenacao: x.coordenacao, supervisao: x.supervisao,
            emails_copia: x.emails_copia, emails_material: x.emails_material
          } : {})
        }));
      if (!novos.length) return toast(`Tudo de ${ctx.ano - 1} já existe em ${ctx.ano}.`, 'ok');
      if (!window.confirm(`Copiar ${novos.length} cadastro(s) de ${ctx.ano - 1} para ${ctx.ano}? Os nomes que já existem não são duplicados.`)) return;
      await inserirVarios(cfg.tabela, novos);
      toast(`${novos.length} cadastro(s) copiado(s) para ${ctx.ano}.`, 'ok');
      carregarLista();
    } catch (err) { mostrarErro(err); }
  }
  main.querySelector('#btn-copiar')?.addEventListener('click', copiarAnoAnterior);
  main.querySelector('#filtro-ano')?.addEventListener('change', (e) => {
    ctx.ano = e.target.value ? Number(e.target.value) : null;
    carregarLista();
  });

  document.getElementById('area-lista').addEventListener('click', async (e) => {
    const editar = e.target.closest('[data-editar]');
    const excluirBtn = e.target.closest('[data-excluir]');
    if (editar) {
      const item = dadosAtuais.find((d) => d.id === editar.dataset.editar);
      abrirForm(item).catch(mostrarErro);
    }
    if (excluirBtn) {
      if (!window.confirm('Excluir este registro? Os planejamentos ligados a ele também podem ser apagados.')) return;
      try {
        await excluir(cfg.tabela, excluirBtn.dataset.excluir);
        toast('Registro excluído.', 'ok');
        carregarLista();
      } catch (err) { mostrarErro(err); }
    }
  });

  carregarLista();
}
