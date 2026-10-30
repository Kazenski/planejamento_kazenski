import { supabase } from './supabase.js';
import { listar, inserir, inserirVarios, atualizar, excluir } from './db.js';
import { esc, abrirModal, formulario, mostrarErro, toast, carregando, lista } from './ui.js';
import { SERIES } from './config.js';
import { abrirMateriaisCurso } from './curso_materiais.js';
import { abrirHorariosColegio } from './horarios_colegio.js';

const anoAtual = new Date().getFullYear();
const norm = (s) => String(s || '').trim().toLowerCase();

const situacao = (ativo) => (ativo === false
  ? '<span class="tag">Inativo</span>'
  : '<span class="tag verde">Ativo</span>');
const contagem = (n, rotulo) => `<span class="tag ${n ? 'azul' : ''}">${n} ${rotulo}</span>`;
const resumo = (texto, max = 70) => {
  if (!texto) return '<span class="muted">—</span>';
  const t = String(texto);
  return esc(t.length > max ? t.slice(0, max) + '…' : t);
};

// Cada cadastro descreve: como listar (com dados extras para a tabela), colunas e campos do formulário.
const CADASTROS = {
  cursos: {
    titulo: 'Cursos técnicos',
    singular: 'curso técnico',
    descricao: 'Cursos técnicos oferecidos. Cada disciplina pertence a um curso, e cada turma também.',
    tabela: 'cursos',
    ordem: 'nome',
    listar: async () => {
      const cursos = await listar('cursos', { ordem: 'nome' });
      const disciplinas = await listar('disciplinas', { select: 'id, curso_id', ordem: null });
      const turmas = await listar('turmas', { select: 'id, curso_id', ordem: null });
      return cursos.map((c) => ({
        ...c,
        nDisc: disciplinas.filter((d) => d.curso_id === c.id).length,
        nTurmas: turmas.filter((t) => t.curso_id === c.id).length
      }));
    },
    colunas: [
      { label: 'Curso', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Disciplinas', valor: (i) => contagem(i.nDisc, i.nDisc === 1 ? 'disciplina' : 'disciplinas') },
      { label: 'Turmas', valor: (i) => contagem(i.nTurmas, i.nTurmas === 1 ? 'turma' : 'turmas') },
      { label: 'Situação', valor: (i) => situacao(i.ativo) }
    ],
    campos: async () => [
      { k: 'nome', label: 'Nome do curso', type: 'text', req: true, largo: true, placeholder: 'Ex.: Técnico em Informática' },
      { k: 'ativo', label: 'Curso ativo', type: 'bool' }
    ]
  },

  colegios: {
    titulo: 'Colégios',
    singular: 'colégio',
    descricao: 'Direção, coordenação, supervisão e e-mails usados nos envios de planejamento. Cada ano tem seu cadastro.',
    tabela: 'colegios',
    ordem: 'nome',
    filtroAno: true,
    copiar: true,
    listar: async (ano) => {
      const colegios = await listar('colegios', { ordem: 'nome', ajuste: (q) => (ano ? q.eq('ano', ano) : q) });
      const turmas = await listar('turmas', { select: 'colegio_id, ano', ordem: null });
      return colegios.map((c) => ({
        ...c,
        nTurmas: turmas.filter((t) => t.colegio_id === c.id).length
      }));
    },
    colunas: [
      { label: 'Colégio', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Ano', valor: (i) => esc(i.ano) },
      { label: 'Turmas', valor: (i) => contagem(i.nTurmas, i.nTurmas === 1 ? 'turma' : 'turmas') },
      { label: 'Direção', valor: (i) => esc(i.direcao || '—') },
      { label: 'Coordenação', valor: (i) => esc(i.coordenacao || '—') },
      { label: 'Supervisão', valor: (i) => esc(i.supervisao || '—') },
      { label: 'Em cópia', valor: (i) => lista(i.emails_copia) },
      { label: 'Envio de material', valor: (i) => lista(i.emails_material) },
      { label: 'Situação', valor: (i) => situacao(i.ativo) }
    ],
    campos: async () => {
      const cursos = await listar('cursos', { ordem: 'nome', ajuste: (q) => q.eq('ativo', true) });
      return [
        { k: 'nome', label: 'Nome do colégio', type: 'text', req: true, largo: true },
        { k: 'direcao', label: 'Direção', type: 'text' },
        { k: 'coordenacao', label: 'Coordenação', type: 'text' },
        { k: 'supervisao', label: 'Supervisão', type: 'text' },
        { k: 'emails_copia', label: 'E-mails em cópia', type: 'lista', ajuda: 'Um por linha ou separados por vírgula.' },
        { k: 'emails_material', label: 'E-mails para envio de material pedagógico', type: 'lista', ajuda: 'Um por linha ou separados por vírgula.' },
        { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
        { k: 'ativo', label: 'Colégio ativo', type: 'bool' },
        { k: 'cursos', label: 'Cursos técnicos oferecidos', type: 'checks', largo: true, opcoes: cursos.map((c) => [c.id, c.nome]), ajuda: 'Escolha os cursos que este colégio oferece. Eles aparecem em Minhas aulas.' }
      ];
    }
  },

  disciplinas: {
    titulo: 'Disciplinas',
    singular: 'disciplina',
    descricao: 'Componentes curriculares. Cada disciplina pertence a um curso técnico. Depois vincule às turmas com a quantidade de aulas por semana.',
    tabela: 'disciplinas',
    ordem: 'nome',
    filtroAno: true,
    copiar: true,
    listar: async (ano) => {
      const disciplinas = await listar('disciplinas', { select: '*, cursos(nome)', ordem: 'nome', ajuste: (q) => (ano ? q.eq('ano', ano) : q) });
      const vinculos = await listar('turma_disciplinas', { select: 'disciplina_id, aulas_semana', ordem: null });
      return disciplinas.map((d) => {
        const v = vinculos.filter((x) => x.disciplina_id === d.id);
        return { ...d, nTurmas: v.length, aulasSemana: v.reduce((s, x) => s + x.aulas_semana, 0) };
      });
    },
    colunas: [
      { label: 'Disciplina', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Curso', valor: (i) => esc(i.cursos?.nome || '—') },
      { label: 'Ano', valor: (i) => esc(i.ano) },
      { label: 'Turmas', valor: (i) => contagem(i.nTurmas, i.nTurmas === 1 ? 'turma' : 'turmas') },
      { label: 'Aulas por semana (soma)', valor: (i) => `<span class="tag laranja">${i.aulasSemana}</span>` },
      { label: 'Situação', valor: (i) => situacao(i.ativo) }
    ],
    campos: async () => {
      const cursos = await listar('cursos', { ordem: 'nome', ajuste: (q) => q.eq('ativo', true) });
      return [
        { k: 'nome', label: 'Nome da disciplina', type: 'text', req: true, largo: true },
        { k: 'curso_id', label: 'Curso técnico', type: 'select', req: true, opcoes: cursos.map((c) => [c.id, c.nome]), vazio: 'Escolha o curso', ajuda: 'Uma disciplina pertence a um único curso.' },
        { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
        { k: 'ativo', label: 'Disciplina ativa', type: 'bool' }
      ];
    }
  },

  turmas: {
    titulo: 'Turmas',
    singular: 'turma',
    descricao: 'Turmas por colégio, curso e ano letivo. A quantidade de alunos e as particularidades aparecem nos planos.',
    tabela: 'turmas',
    ordem: 'nome',
    filtroAno: true,
    copiar: true,
    listar: async (ano) => {
      const turmas = await listar('turmas', {
        select: '*, colegios(nome), cursos(nome)',
        ordem: 'nome',
        ajuste: (q) => (ano ? q.eq('ano', ano) : q)
      });
      const vinculos = await listar('turma_disciplinas', { select: 'turma_id, aulas_semana', ordem: null });
      return turmas.map((t) => {
        const v = vinculos.filter((x) => x.turma_id === t.id);
        return { ...t, nDisc: v.length, aulasSemana: v.reduce((s, x) => s + x.aulas_semana, 0) };
      });
    },
    colunas: [
      { label: 'Colégio', valor: (i) => esc(i.colegios?.nome || '—') },
      { label: 'Turma', valor: (i) => `<strong>${esc(i.nome)}</strong>` },
      { label: 'Série', valor: (i) => esc(SERIES[i.serie] || i.serie) },
      { label: 'Curso', valor: (i) => esc(i.cursos?.nome || i.curso || '—') },
      { label: 'Ano', valor: (i) => esc(i.ano) },
      { label: 'Alunos', valor: (i) => esc(i.qtd_alunos ?? '—') },
      { label: 'Disciplinas', valor: (i) => contagem(i.nDisc, i.nDisc === 1 ? 'disciplina' : 'disciplinas') },
      { label: 'Aulas por semana', valor: (i) => `<span class="tag laranja">${i.aulasSemana}</span>` },
      { label: 'Particularidades', valor: (i) => resumo(i.observacoes) },
      { label: 'Situação', valor: (i) => situacao(i.ativo) }
    ],
    campos: async () => {
      const colegios = await listar('colegios', { ordem: 'nome' });
      const cursos = await listar('cursos', { ordem: 'nome', ajuste: (q) => q.eq('ativo', true) });
      CADASTROS.turmas.cursosCache = cursos;
      return [
        { k: 'colegio_id', label: 'Colégio', type: 'select', req: true, opcoes: colegios.map((c) => [c.id, `${c.nome} (${c.ano})`]), vazio: 'Escolha o colégio' },
        { k: 'nome', label: 'Nome da turma', type: 'text', req: true, placeholder: 'Ex.: 1º A' },
        { k: 'ano', label: 'Ano letivo', type: 'number', req: true, min: 2000, max: 2100, step: 1 },
        { k: 'serie', label: 'Série', type: 'select', req: true, opcoes: Object.entries(SERIES).map(([v, r]) => [v, r]) },
        { k: 'curso_id', label: 'Curso técnico', type: 'select', req: true, opcoes: cursos.map((c) => [c.id, c.nome]), vazio: 'Escolha o curso' },
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
    copiar: true,
    listar: (ano) => listar('turma_disciplinas', {
      select: '*, turmas!inner(nome, ano, serie, colegios(nome)), disciplinas(nome, cursos(nome))',
      ordem: null,
      ajuste: (q) => (ano ? q.eq('turmas.ano', ano) : q)
    }),
    colunas: [
      { label: 'Colégio', valor: (i) => esc(i.turmas?.colegios?.nome || '—') },
      { label: 'Turma', valor: (i) => `<strong>${esc(i.turmas?.nome || '—')}</strong>` },
      { label: 'Série', valor: (i) => esc(SERIES[i.turmas?.serie] || '—') },
      { label: 'Ano', valor: (i) => esc(i.turmas?.ano || '—') },
      { label: 'Curso', valor: (i) => esc(i.disciplinas?.cursos?.nome || '—') },
      { label: 'Disciplina', valor: (i) => esc(i.disciplinas?.nome || '—') },
      { label: 'Aulas por semana', valor: (i) => `<span class="tag laranja">${esc(i.aulas_semana)}</span>` }
    ],
    campos: async (ctx) => {
      const turmas = await listar('turmas', { select: '*, colegios(nome)', ordem: 'nome', ajuste: (q) => (ctx.ano ? q.eq('ano', ctx.ano) : q) });
      const disciplinas = await listar('disciplinas', { select: '*, cursos(nome)', ordem: 'nome' });
      return [
        { k: 'turma_id', label: 'Turma', type: 'select', req: true, opcoes: turmas.map((t) => [t.id, `${t.colegios?.nome || ''} · ${t.nome} (${t.ano})`]), vazio: 'Escolha a turma' },
        { k: 'disciplina_id', label: 'Disciplina', type: 'select', req: true, opcoes: disciplinas.map((d) => [d.id, `${d.nome} · ${d.cursos?.nome || 'sem curso'} (${d.ano})`]), vazio: 'Escolha a disciplina' },
        { k: 'aulas_semana', label: 'Aulas por semana', type: 'number', req: true, min: 1, max: 12, step: 1, ajuda: 'Exemplo: 2 aulas de 50 minutos por semana.' }
      ];
    }
  }
};

// Copia do ano anterior para turmas: mesmo colégio (pelo nome), sem duplicar.
async function copiarTurmas(ano) {
  const origem = await listar('turmas', { select: '*, colegios(nome)', ordem: null, ajuste: (q) => q.eq('ano', ano - 1) });
  if (!origem.length) return { erro: `Não há turmas em ${ano - 1} para copiar.` };
  const colegios = await listar('colegios', { ordem: null, ajuste: (q) => q.eq('ano', ano) });
  const atuais = await listar('turmas', { ordem: null, ajuste: (q) => q.eq('ano', ano) });
  const novos = [];
  let semColegio = 0;
  for (const t of origem) {
    const c = colegios.find((x) => norm(x.nome) === norm(t.colegios?.nome));
    if (!c) { semColegio++; continue; }
    if (atuais.some((a) => a.colegio_id === c.id && norm(a.nome) === norm(t.nome))) continue;
    novos.push({
      colegio_id: c.id, ano, nome: t.nome, serie: t.serie, curso: t.curso, curso_id: t.curso_id,
      qtd_alunos: t.qtd_alunos, observacoes: t.observacoes, ativo: t.ativo
    });
  }
  return { novos, semColegio };
}

// Copia do ano anterior para aulas por disciplina: liga às turmas e disciplinas do ano escolhido (pelo nome).
async function copiarAulas(ano) {
  const origem = await listar('turma_disciplinas', {
    select: '*, turmas!inner(nome, ano, colegios(nome)), disciplinas(nome)', ordem: null, ajuste: (q) => q.eq('turmas.ano', ano - 1)
  });
  if (!origem.length) return { erro: `Não há aulas por disciplina em ${ano - 1} para copiar.` };
  const turmas = await listar('turmas', { select: 'id, nome, colegio_id, colegios(nome)', ordem: null, ajuste: (q) => q.eq('ano', ano) });
  const disciplinas = await listar('disciplinas', { select: 'id, nome', ordem: null, ajuste: (q) => q.eq('ano', ano) });
  const atuais = await listar('turma_disciplinas', { select: 'turma_id, disciplina_id, turmas!inner(ano)', ordem: null, ajuste: (q) => q.eq('turmas.ano', ano) });
  const novos = [];
  let semTurma = 0;
  let semDisc = 0;
  for (const v of origem) {
    const t = turmas.find((x) => norm(x.nome) === norm(v.turmas?.nome) && norm(x.colegios?.nome) === norm(v.turmas?.colegios?.nome));
    const d = disciplinas.find((x) => norm(x.nome) === norm(v.disciplinas?.nome));
    if (!t) { semTurma++; continue; }
    if (!d) { semDisc++; continue; }
    if (atuais.some((a) => a.turma_id === t.id && a.disciplina_id === d.id)) continue;
    novos.push({ turma_id: t.id, disciplina_id: d.id, aulas_semana: v.aulas_semana });
  }
  return { novos, semTurma, semDisc };
}

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
                  ${chave === 'cursos' ? `<button class="btn pequeno azul" data-materiais="${i.id}" type="button">Materiais</button>` : ''}
                  ${chave === 'colegios' ? `<button class="btn pequeno azul" data-horarios="${i.id}" type="button">Horários</button>` : ''}
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
    const valores = item ? { ...item } : { ano: ctx.ano || anoAtual, ativo: true, serie: 1 };
    if (item && chave === 'colegios') {
      const vinculos = await listar('colegio_cursos', { select: 'curso_id', ordem: null, ajuste: (q) => q.eq('colegio_id', item.id) });
      valores.cursos = vinculos.map((v) => v.curso_id);
    }
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
        let cursosDoColegio = null;
        if (chave === 'colegios') {
          dados.emails_copia = dados.emails_copia || [];
          dados.emails_material = dados.emails_material || [];
          cursosDoColegio = dados.cursos || [];
          delete dados.cursos;
        }
        if (chave === 'turmas' && dados.serie) dados.serie = Number(dados.serie);
        if (chave === 'turmas') dados.curso = cfg.cursosCache?.find((c) => c.id === dados.curso_id)?.nome ?? null;
        let id = item?.id;
        if (item) await atualizar(cfg.tabela, item.id, dados);
        else {
          const [novo] = await inserir(cfg.tabela, dados);
          id = novo.id;
        }
        if (chave === 'colegios') {
          const { error: erroApagar } = await supabase.from('colegio_cursos').delete().eq('colegio_id', id);
          if (erroApagar) throw erroApagar;
          if (cursosDoColegio.length) {
            const { error } = await supabase.from('colegio_cursos').insert(cursosDoColegio.map((curso_id) => ({ colegio_id: id, curso_id })));
            if (error) throw error;
          }
        }
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

      if (chave === 'turmas' || chave === 'aulas') {
        const r = chave === 'turmas' ? await copiarTurmas(ctx.ano) : await copiarAulas(ctx.ano);
        if (r.erro) return toast(r.erro, 'erro');
        const avisos = [];
        if (r.semColegio) avisos.push(`${r.semColegio} turma(s) sem colégio correspondente em ${ctx.ano}`);
        if (r.semTurma) avisos.push(`${r.semTurma} vínculo(s) sem turma correspondente em ${ctx.ano}`);
        if (r.semDisc) avisos.push(`${r.semDisc} vínculo(s) sem disciplina correspondente em ${ctx.ano}`);
        if (avisos.length) toast(`${avisos.join('; ')}. Copie colégios, disciplinas e turmas primeiro.`, 'erro');
        if (!r.novos.length) return toast('Nada novo para copiar.', 'ok');
        if (!window.confirm(`Copiar ${r.novos.length} registro(s) de ${ctx.ano - 1} para ${ctx.ano}? Os que já existem não são duplicados.`)) return;
        await inserirVarios(cfg.tabela, r.novos);
        toast(`${r.novos.length} registro(s) copiado(s) para ${ctx.ano}.`, 'ok');
        carregarLista();
        return;
      }

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
          } : {}),
          ...(chave === 'disciplinas' ? { curso_id: x.curso_id } : {})
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
    const materiais = e.target.closest('[data-materiais]');
    if (materiais) {
      abrirMateriaisCurso(dadosAtuais.find((d) => d.id === materiais.dataset.materiais));
    }
    const horarios = e.target.closest('[data-horarios]');
    if (horarios) {
      abrirHorariosColegio(dadosAtuais.find((d) => d.id === horarios.dataset.horarios), carregarLista);
    }
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
