import { supabase } from './supabase.js';
import { listar, inserir, atualizar, excluir, getConfig } from './db.js';
import { esc, el, abrirModal, fecharModal, formulario, toast, mostrarErro, carregando, tagStatus, lista } from './ui.js';
import { MESES, MESES_PLANEJAMENTO, SERIES, DIAS_LETIVOS_PADRAO, STATUS_PLANO, DIAS_SEMANA } from './config.js';
import { diasDoAno, diasLetivos, aulasPorDia, diaSemanaDe, diasDoMes } from './regras.js';
import { seletorMateriais } from './materiais.js';

// Premissa: 3 trimestres dentro do ano letivo (fev-dez). Ajustar aqui se o colégio mudar.
const TRIMESTRES = { 1: [2, 3, 4], 2: [5, 6, 7, 8], 3: [9, 10, 11, 12] };
const NOMES_TRIMESTRE = { 1: '1º trimestre (fev–abr)', 2: '2º trimestre (mai–ago)', 3: '3º trimestre (set–dez)' };
const STATUS_ITEM = { mantido: 'Mantido', novo: 'Novo', alterado: 'Alterado', removido: 'Removido' };
const ACAO_MES = { trabalhar: 'Trabalhar neste mês', manter: 'Previsto em outro mês', adiar: 'Adiar para o próximo mês', remover: 'Remover do ano' };

function trimestreDoMes(mes) {
  return Number(Object.keys(TRIMESTRES).find((t) => TRIMESTRES[t].includes(mes)));
}

const SELECT_ANUAL = 'id, ano, versao, status, conteudo, origem_id, turma_id, disciplina_id, turmas(nome, ano, serie, qtd_alunos, colegio_id, colegios(nome)), disciplinas(nome)';

function rotuloAnual(p) {
  return `${p.turmas?.colegios?.nome || '—'} · ${p.turmas?.nome || '—'} · ${p.disciplinas?.nome || '—'} · ${p.ano} (v${p.versao})`;
}

async function carregarAnuais() {
  return listar('planos_anuais', { select: SELECT_ANUAL, ordem: 'ano', asc: false });
}

async function invocarIA(body) {
  const { data, error } = await supabase.functions.invoke('gerar-planejamento', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem corpo JSON */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

// ---------- Editor da entrada de conteúdos (lista do ano) ----------
function editorConteudos(itens) {
  const wrap = el('<div></div>');
  const linhas = el('<div class="dia-lista" style="gap:10px"></div>');
  wrap.appendChild(linhas);
  const reset = (novos) => {
    linhas.replaceChildren();
    (novos.length ? novos : [{}]).forEach((i) => linha(i));
  };

  function linha(item = {}) {
    const row = el(`
      <div class="dia-item" style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end">
        <label class="campo"><span>Conteúdo</span><input data-c="titulo" value="${esc(item.titulo || '')}" placeholder="Ex.: Lógica de programação"></label>
        <label class="campo"><span>Trimestre</span><select data-c="trimestre">${[1, 2, 3].map((t) => `<option value="${t}" ${Number(item.trimestre || 1) === t ? 'selected' : ''}>${t}º</option>`).join('')}</select></label>
        <label class="campo"><span>Situação</span><select data-c="status">${Object.entries(STATUS_ITEM).map(([v, r]) => `<option value="${v}" ${(item.status || 'novo') === v ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <button type="button" class="btn pequeno perigo" data-c="remover">Remover</button>
        <label class="campo" style="grid-column:1/-1"><span>Observação (opcional)</span><input data-c="observacao" value="${esc(item.observacao || '')}" placeholder="Ex.: aprofundar com Python"></label>
      </div>`);
    row.querySelector('[data-c="remover"]').onclick = () => row.remove();
    linhas.appendChild(row);
  }

  const botao = el('<button type="button" class="btn azul pequeno" style="margin-top:10px">+ Adicionar conteúdo</button>');
  botao.onclick = () => linha({ status: 'novo' });
  wrap.appendChild(botao);
  reset(itens);

  return {
    el: wrap,
    reset,
    ler() {
      return [...linhas.children].map((r) => ({
        titulo: r.querySelector('[data-c="titulo"]').value.trim(),
        trimestre: Number(r.querySelector('[data-c="trimestre"]').value),
        status: r.querySelector('[data-c="status"]').value,
        observacao: r.querySelector('[data-c="observacao"]').value.trim() || null
      })).filter((i) => i.titulo);
    }
  };
}

// ---------- Renderização do plano gerado ----------
function renderPlanoAnual(plano) {
  if (!plano || !plano.trimestres) {
    return '<div class="aviso azul">Este plano ainda não tem conteúdo gerado. Clique em "Gerar com IA" ou em "Editar conteúdos" para começar.</div>';
  }
  const lista = (itens) => ((itens || []).length ? `<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
  const tags = (itens) => (itens || []).map((h) => `<span class="tag azul" style="margin:2px">${esc(h)}</span>`).join(' ');
  const secao = (titulo, corpo) => (corpo ? `<section class="card" style="margin-bottom:14px"><h3>${titulo}</h3>${corpo}</section>` : '');
  const id = plano.identificacao;
  const identificacao = id ? secao('I. Identificação da disciplina', `
    <table class="tabela"><tbody>
      <tr><td>Série/ano</td><td>${esc(id.serie_ano || '')}</td><td>Componente</td><td>${esc(id.componente || '')}</td></tr>
      <tr><td>Aulas semanais</td><td>${esc(id.aulas_semanais || '')}</td><td>Turma(s)</td><td>${esc(id.turmas || '')}</td></tr>
      <tr><td>Ano letivo</td><td colspan="3">${esc(id.ano_letivo || '')}</td></tr>
    </tbody></table>`) : '';
  const competencias = secao('III. Competências gerais', lista(plano.competencias_gerais))
    + secao('Competências específicas', lista(plano.competencias_especificas));
  const trimestres = plano.trimestres.map((t) => `
    <div class="plano-trimestre">
      <header>${esc(t.numero)}º trimestre · ${esc(t.titulo || '')}</header>
      <div>
        ${(t.objetivos || []).length ? `<div class="rotulo-secao">Objetivos de aprendizagem</div><ul>${t.objetivos.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        ${(t.conteudos || []).map((c) => `
          <div class="plano-conteudo">
            <h4>${esc(c.titulo)}</h4>
            ${c.unidade_tematica ? `<p><strong>Unidade temática:</strong> ${esc(c.unidade_tematica)}</p>` : ''}
            ${c.descricao ? `<p>${esc(c.descricao)}</p>` : ''}
            ${(c.objeto_conhecimento || []).length ? `<div class="rotulo-secao">Objeto do conhecimento</div>${lista(c.objeto_conhecimento)}` : ''}
            ${(c.topicos || []).length ? `<div class="rotulo-secao">Tópicos</div>${lista(c.topicos)}` : ''}
            ${(c.habilidades || []).length ? `<div class="rotulo-secao">Habilidades</div><div>${tags(c.habilidades)}</div>` : ''}
            ${c.metodologia ? `<div class="rotulo-secao">Metodologia/estratégia</div><p>${esc(c.metodologia)}</p>` : ''}
            ${(c.materiais || []).length ? `<div class="rotulo-secao">Materiais de apoio</div>${lista(c.materiais)}` : ''}
            ${c.avaliacao ? `<div class="rotulo-secao">Avaliação</div><p>${esc(c.avaliacao)}</p>` : ''}
            ${c.aulas_estimadas ? `<p class="small muted">Aulas estimadas: ${esc(c.aulas_estimadas)}</p>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');
  const rec = plano.recomposicao;
  const recomposicao = rec ? secao('VII. Recomposição das aprendizagens', `
    ${rec.unidade_tematica ? `<p><strong>Unidade temática:</strong> ${esc(rec.unidade_tematica)}</p>` : ''}
    ${lista(rec.objeto_conhecimento)}
    ${(rec.habilidades || []).length ? `<div>${tags(rec.habilidades)}</div>` : ''}
    ${rec.metodologia ? `<p>${esc(rec.metodologia)}</p>` : ''}`) : '';
  const pi = plano.projetos_integradores;
  const projetos = pi ? secao('VIII. Projetos integradores', `
    ${pi.temas ? `<p><strong>Temas:</strong> ${esc(pi.temas)}</p>` : ''}
    ${pi.tema_especifico ? `<p><strong>Tema específico:</strong> ${esc(pi.tema_especifico)}</p>` : ''}
    ${(pi.habilidades_macroarea || []).length ? `<div>${tags(pi.habilidades_macroarea)}</div>` : ''}
    ${pi.metodologia ? `<p>${esc(pi.metodologia)}</p>` : ''}
    ${lista(pi.atividades)}`) : '';
  const tt = plano.temas_transversais;
  const transversais = tt ? secao('IX. Temas curriculares transversais', `
    ${(tt.competencias_gerais || []).length ? `<div class="rotulo-secao">Competências gerais</div>${lista(tt.competencias_gerais)}` : ''}
    ${(tt.competencias_especificas || []).length ? `<div class="rotulo-secao">Competências específicas</div>${lista(tt.competencias_especificas)}` : ''}
    ${(tt.habilidades_macroarea || []).length ? `<div>${tags(tt.habilidades_macroarea)}</div>` : ''}
    ${tt.metodologia ? `<p>${esc(tt.metodologia)}</p>` : ''}`) : '';
  const av = plano.avaliacao;
  const avaliacao = av ? secao('X. Avaliações e critérios avaliativos', `
    ${(av.instrumentos || []).length ? `<div class="rotulo-secao">Instrumentos</div>${lista(av.instrumentos)}` : ''}
    ${(av.criterios || []).length ? `<div class="rotulo-secao">Critérios</div>${lista(av.criterios)}` : ''}`) : '';
  const referencias = secao('XI. Referências', lista(plano.referencias));
  const professor = plano.professor ? secao('II. Professor responsável', `<p>${esc(plano.professor)}</p>`) : '';
  return identificacao + professor + competencias + trimestres + recomposicao + projetos + transversais + avaliacao + referencias
    + (plano.observacoes ? `<div class="aviso verde">${esc(plano.observacoes)}</div>` : '');
}

// ---------- Tela ----------
export async function telaPlanos(main) {
  main.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1>Planejamentos</h1>
        <p>O anual é a fonte da verdade. O mensal é um recorte dele e o diário sai de um mensal gerado.</p>
      </div>
    </div>
    <div class="abas" id="abas">
      <button data-aba="anual" class="ativa" type="button">1 · Anual</button>
      <button data-aba="mensal" type="button">2 · Mensal</button>
      <button data-aba="diario" type="button">3 · Diário</button>
    </div>
    <div id="aba-conteudo">${carregando()}</div>`;

  const trocar = (aba) => {
    main.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
    const area = document.getElementById('aba-conteudo');
    area.innerHTML = carregando();
    const fn = { anual: abaAnual, mensal: abaMensal, diario: abaDiario }[aba];
    fn(area).catch(mostrarErro);
  };
  main.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => trocar(b.dataset.aba)));
  trocar('anual');
}

// ---------- Aba 1: Anual ----------
async function abaAnual(area) {
  const planos = await carregarAnuais();
  area.innerHTML = `
    <div class="acoes" style="justify-content:space-between;margin-bottom:14px">
      <p class="muted" style="margin:0">Um plano por turma, disciplina e versão. Ao virar o ano, crie a partir do plano anterior e ajuste os conteúdos.</p>
      <div class="acoes">
        <button class="btn" id="btn-importar-anual" type="button">Importar plano anterior</button>
        <button class="btn primary" id="btn-novo-anual" type="button">+ Novo plano anual</button>
      </div>
    </div>
    ${planos.length ? `
    <div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Colégio</th><th>Turma</th><th>Disciplina</th><th>Ano</th><th>Versão</th><th>Situação</th><th>Conteúdo</th><th></th></tr></thead>
      <tbody>
        ${planos.map((p) => `
          <tr>
            <td>${esc(p.turmas?.colegios?.nome || '—')}</td>
            <td>${esc(p.turmas?.nome || '—')}</td>
            <td><strong>${esc(p.disciplinas?.nome || '—')}</strong></td>
            <td>${p.ano}</td>
            <td>v${p.versao}</td>
            <td>${tagStatus(p.status, STATUS_PLANO)}</td>
            <td>${p.conteudo?.plano?.trimestres ? `<span class="tag verde">${p.conteudo.plano.trimestres.length} trimestres</span>` : '<span class="tag">sem conteúdo</span>'}</td>
            <td class="acoes-linha">
              <button class="btn pequeno" data-ver="${p.id}" type="button">Abrir</button>
              <button class="btn pequeno azul" data-ia="${p.id}" type="button">Gerar com IA</button>
              <button class="btn pequeno" data-editar="${p.id}" type="button">Editar conteúdos</button>
              <button class="btn pequeno perigo" data-excluir="${p.id}" type="button">Excluir</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="tabela-wrap"><div class="vazio">Nenhum plano anual ainda. Cadastre turma e disciplinas, depois clique em "+ Novo plano anual".</div></div>'}`;

  area.querySelector('#btn-novo-anual').onclick = () => abrirNovoAnual(planos).catch(mostrarErro);
  area.querySelector('#btn-importar-anual').onclick = () => abrirImportarAnual(area).catch(mostrarErro);

  area.onclick = async (e) => {
    const b = e.target.closest('button[data-ver],button[data-ia],button[data-editar],button[data-excluir]');
    if (!b) return;
    const id = b.dataset.ver || b.dataset.ia || b.dataset.editar || b.dataset.excluir;
    const plano = planos.find((p) => p.id === id);
    try {
      if (b.dataset.ver) abrirVerAnual(plano);
      if (b.dataset.editar) abrirEditarAnual(plano, area);
      if (b.dataset.excluir) {
        if (!window.confirm('Excluir este plano anual? Os planos mensais e diários dele também serão apagados.')) return;
        await excluir('planos_anuais', id);
        toast('Plano anual excluído.', 'ok');
        abaAnual(area);
      }
      if (b.dataset.ia) await abrirGerarAnual(plano, area);
    } catch (err) { mostrarErro(err); }
  };
}

// Antes de gerar, o professor escolhe os materiais que a IA pode consultar e escreve observações.
async function abrirGerarAnual(plano, area) {
  const seletor = await seletorMateriais({ disciplina: plano.disciplinas?.nome });
  const perguntas = el(`<div class="card" style="box-shadow:none;border:1px solid var(--borda);margin-bottom:16px">
    <h3 style="margin-bottom:6px">Projetos, dinâmica e avaliação</h3>
    <label class="campo"><span>Que tipos de projeto você quer desenvolver com a turma?</span>
      <textarea id="gen-projetos" placeholder="Ex.: sistema de gestão de estoque para a loja da escola; aplicativo de cadastro; jogo com lógica de programação"></textarea></label>
    <label class="campo" style="margin-top:12px"><span>Você quer trocar provas pela aplicação desses projetos?</span>
      <select id="gen-provas">
        <option value="nao">Não, manter as provas escritas</option>
        <option value="todas">Sim, em todas as avaliações</option>
        <option value="algumas">Sim, só em algumas (descreva em observações)</option>
      </select></label>
  </div>`);
  const projetoBloco = el(`<div class="card" style="box-shadow:none;border:1px solid var(--borda);margin-bottom:16px">
    <h3 style="margin-bottom:6px">Projeto/dinâmica para este ano</h3>
    <p class="small muted" style="margin-top:-4px;margin-bottom:12px">Descreva a ideia que quer colocar em prática com a turma. A IA vai tentar encaixar no plano e, se autorizado, redistribuir aulas entre conteúdo e aplicação.</p>
    <label class="campo"><span>Título ou ideia do projeto/dinâmica</span>
      <textarea id="gen-projeto-ideia" placeholder="Ex.: Criar um site para a feira de ciências com cadastro de visitantes"></textarea></label>
    <label class="campo" style="margin-top:12px"><span>Colar detalhes, etapas ou rascunho</span>
      <textarea id="gen-projeto-texto" placeholder="Cole aqui objetivos, etapas, produtos esperados, público, etc."></textarea></label>
    <label class="campo" style="margin-top:12px"><span>Anexar ideia (.TXT, .MD, .PDF, .DOCX)</span>
      <input type="file" id="gen-projeto-arq" accept=".txt,.md,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"></label>
    <div class="campos-grid" style="margin-top:12px">
      <label class="campo"><span>Reservar aulas para aplicação/orientação do projeto?</span>
        <select id="gen-reservar">
          <option value="decidir">Decidir com a IA</option>
          <option value="sim">Sim, reservar aulas para o projeto</option>
          <option value="nao">Não, não reservar aulas exclusivas</option>
        </select></label>
      <label class="campo"><span>Abrir mão de aulas de conteúdo para isso?</span>
        <select id="gen-redistribuir">
          <option value="essenciais">Apenas conteúdos menos essenciais (critério)</option>
          <option value="todos">Sim, posso reduzir conteúdos secundários se necessário</option>
          <option value="nenhum">Não, manter toda a carga horária dos conteúdos</option>
        </select></label>
    </div>
  </div>`);
  const conteudo = el('<div></div>');
  conteudo.append(perguntas, projetoBloco, seletor.el);
  abrirModal({
    titulo: `Gerar plano anual · ${plano.disciplinas?.nome}`,
    conteudo,
    grande: true,
    submitLabel: 'Gerar com IA',
    onSubmit: async (fechar) => {
      const { fonte_ids, observacoes } = seletor.ler();
      if (!fonte_ids.length) throw new Error('Marque ao menos um material na Base para a IA antes de gerar.');
      fechar();
      toast('Gerando o plano anual com IA. Isso pode levar alguns segundos...', '');

      const projetos = perguntas.querySelector('#gen-projetos').value.trim();
      const substituir_provas = perguntas.querySelector('#gen-provas').value;
      const projetoIdeia = projetoBloco.querySelector('#gen-projeto-ideia').value.trim();
      const projetoTexto = projetoBloco.querySelector('#gen-projeto-texto').value.trim();
      const reservar = projetoBloco.querySelector('#gen-reservar').value;
      const redistribuir = projetoBloco.querySelector('#gen-redistribuir').value;
      const arq = projetoBloco.querySelector('#gen-projeto-arq').files[0];

      let ideia_arquivo_caminho = null;
      let ideia_arquivo_nome = null;
      if (arq) {
        if (!/\.(txt|md|pdf|docx)$/i.test(arq.name)) throw new Error('Anexe um arquivo .TXT, .MD, .PDF ou .DOCX.');
        if (arq.size > 20 * 1024 * 1024) throw new Error('O arquivo passa de 20 MB.');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Sessão expirada. Entre novamente.');
        const seguro = arq.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-');
        const caminho = `${user.id}/projetos_ideias/${Date.now()}-${seguro}`;
        const { error: erroUp } = await supabase.storage.from('materiais').upload(caminho, arq, {
          contentType: arq.type || 'application/octet-stream',
          upsert: false
        });
        if (erroUp) throw new Error(`Não foi possível enviar o arquivo da ideia: ${erroUp.message}`);
        ideia_arquivo_caminho = caminho;
        ideia_arquivo_nome = arq.name;
      }

      await invocarIA({
        tipo: 'anual',
        plano_id: plano.id,
        fonte_ids,
        observacoes,
        projetos,
        substituir_provas,
        projeto: projetoIdeia,
        ideia_texto: projetoTexto,
        ideia_arquivo_caminho,
        ideia_arquivo_nome,
        reservar_para_projeto: reservar,
        redistribuir_conteudo: redistribuir
      });
      toast('Plano anual gerado.', 'ok');
      abaAnual(area);
    }
  });
}

function abrirVerAnual(plano) {
  const conteudo = el(`<div>
    <div class="faixa" style="margin-bottom:16px">
      <div><strong>${esc(plano.disciplinas?.nome)}</strong> · ${esc(plano.turmas?.nome)} · ${esc(plano.turmas?.colegios?.nome)}</div>
      <div class="muted">${SERIES[plano.turmas?.serie] || ''} · ${esc(plano.turmas?.qtd_alunos ?? '—')} alunos · ano ${plano.ano} · versão ${plano.versao}</div>
    </div>
    ${renderPlanoAnual(plano.conteudo?.plano)}
  </div>`);
  abrirModal({ titulo: `Plano anual · ${plano.disciplinas?.nome}`, conteudo, grande: true });
}

// Importa um plano anual anterior (DOCX ou PDF): o arquivo vai ao Storage e a IA converte o texto no plano do sistema.
async function abrirImportarAnual(area) {
  const [turmas, disciplinas] = await Promise.all([
    listar('turmas', { select: '*, colegios(nome)', ordem: 'nome' }),
    listar('disciplinas', { ordem: 'nome' })
  ]);
  if (!turmas.length) throw new Error('Cadastre uma turma antes de importar um plano.');
  const conteudo = el(`<div>
    <div class="aviso azul" style="margin-bottom:14px">Envie o plano anterior em DOCX ou PDF. A IA lê o arquivo e preenche um plano anual no formato do sistema. Depois você revisa o plano e gera os mensais e diários.</div>
    <div class="campos-grid">
      <label class="campo"><span>Turma</span><select id="imp-turma"><option value="">Escolha a turma</option>${turmas.map((t) => `<option value="${t.id}">${esc(t.colegios?.nome || '')} · ${esc(t.nome)} (${t.ano})</option>`).join('')}</select></label>
      <label class="campo"><span>Disciplina</span><select id="imp-disc"><option value="">Escolha a disciplina</option>${disciplinas.map((d) => `<option value="${d.id}">${esc(d.nome)} (${d.ano})</option>`).join('')}</select></label>
      <label class="campo"><span>Ano letivo</span><input type="number" id="imp-ano" value="${new Date().getFullYear()}"></label>
      <label class="campo"><span>Arquivo do plano (DOCX ou PDF)</span><input type="file" id="imp-arquivo" accept=".docx,.pdf"></label>
    </div>
  </div>`);
  abrirModal({
    titulo: 'Importar plano anual anterior',
    conteudo,
    grande: true,
    submitLabel: 'Importar com IA',
    onSubmit: async (fechar) => {
      const turmaId = conteudo.querySelector('#imp-turma').value;
      const discId = conteudo.querySelector('#imp-disc').value;
      const ano = Number(conteudo.querySelector('#imp-ano').value);
      const arq = conteudo.querySelector('#imp-arquivo').files[0];
      if (!turmaId || !discId || !ano || !arq) throw new Error('Escolha turma, disciplina, ano e o arquivo.');
      if (!/\.(docx|pdf)$/i.test(arq.name)) throw new Error('Envie um arquivo DOCX ou PDF.');
      if (arq.size > 20 * 1024 * 1024) throw new Error('O arquivo passa de 20 MB.');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada. Entre novamente.');
      const seguro = arq.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-');
      const caminho = `${user.id}/planos_anteriores/${Date.now()}-${seguro}`;
      const { error: erroUp } = await supabase.storage.from('materiais').upload(caminho, arq, {
        contentType: arq.type || 'application/octet-stream',
        upsert: false
      });
      if (erroUp) throw new Error(`Não foi possível enviar o arquivo: ${erroUp.message}`);
      fechar();
      toast('Importando o plano com IA. Isso pode levar alguns segundos...', '');
      const { data, error } = await supabase.functions.invoke('importar-plano', {
        body: { caminho, nome: arq.name, turma_id: turmaId, disciplina_id: discId, ano }
      });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem corpo JSON */ }
        throw new Error(msg);
      }
      if (data?.erro) throw new Error(data.erro);
      toast('Plano anual importado. Revise o conteúdo.', 'ok');
      abaAnual(area);
    }
  });
}

async function abrirNovoAnual(planos) {
  const [turmas, turmaDisc, disciplinas] = await Promise.all([
    listar('turmas', { select: '*, colegios(nome)', ordem: 'nome' }),
    listar('turma_disciplinas', { select: 'turma_id, disciplina_id, aulas_semana', ordem: null }),
    listar('disciplinas', { ordem: 'nome' })
  ]);
  if (!turmas.length) throw new Error('Cadastre uma turma antes de criar o plano anual.');

  const f = formulario([
    { k: 'turma_id', label: 'Turma', type: 'select', req: true, largo: true, opcoes: turmas.map((t) => [t.id, `${t.colegios?.nome} · ${t.nome} (${t.ano})`]), vazio: 'Escolha a turma' },
    { k: 'disciplina_id', label: 'Disciplina', type: 'select', req: true, largo: true, opcoes: disciplinas.map((d) => [d.id, `${d.nome} (${d.ano})`]), vazio: 'Escolha a disciplina', ajuda: 'Só aparecem disciplinas vinculadas à turma em "Aulas por disciplina".' },
    { k: 'origem_id', label: 'Partir de', type: 'select', largo: true, opcoes: planos.map((p) => [p.id, rotuloAnual(p)]), vazio: 'Do zero (sem plano anterior)', ajuda: 'Copia a lista de conteúdos do plano escolhido. Você marca o que mudou.' }
  ], {});

  const area = el('<div></div>');
  area.appendChild(f.el);
  const info = el('<div class="aviso azul" style="margin-top:14px" hidden></div>');
  area.appendChild(info);

  const selTurma = f.el.querySelector('select[name="turma_id"]');
  const selDisc = f.el.querySelector('select[name="disciplina_id"]');
  const selOrigem = f.el.querySelector('select[name="origem_id"]');
  const atualizarInfo = () => {
    const t = turmas.find((x) => x.id === selTurma.value);
    const vinculo = turmaDisc.find((x) => x.turma_id === selTurma.value && x.disciplina_id === selDisc.value);
    const disponiveis = new Set(turmaDisc.filter((x) => x.turma_id === selTurma.value).map((x) => x.disciplina_id));
    [...selDisc.options].forEach((o) => { if (o.value) o.hidden = !disponiveis.has(o.value); });
    if (!disponiveis.size && t) {
      info.className = 'aviso';
      info.textContent = 'Esta turma não tem disciplinas vinculadas. Cadastre em "Aulas por disciplina".';
      info.hidden = false;
    } else if (t && vinculo) {
      info.className = 'aviso azul';
      info.innerHTML = `<strong>${esc(t.qtd_alunos ?? '—')}</strong> alunos · <strong>${vinculo.aulas_semana}</strong> aula(s) por semana. Esses dados entram no cabeçalho e na distribuição das aulas.`;
      info.hidden = false;
    } else {
      info.hidden = true;
    }
  };
  selTurma.addEventListener('change', atualizarInfo);
  selDisc.addEventListener('change', atualizarInfo);

  const editor = editorConteudos([]);
  const bloco = el('<div class="separador"></div>');
  const titulo = el('<h3 style="margin-bottom:8px">Conteúdos do ano</h3>');
  const dica = el('<p class="small muted">Marque a situação de cada conteúdo. "Novo" entra no plano. "Mantido" continua. "Alterado" recebe a observação. "Removido" sai do plano.</p>');
  area.append(bloco, titulo, dica, editor.el);

  selOrigem.addEventListener('change', () => {
    const origem = planos.find((p) => p.id === selOrigem.value);
    const itens = (origem?.conteudo?.entrada?.conteudos || []).map((c) => ({
      ...c,
      status: c.status === 'removido' ? 'removido' : 'mantido'
    }));
    editor.reset(itens);
  });

  abrirModal({
    titulo: 'Novo plano anual',
    conteudo: area,
    grande: true,
    submitLabel: 'Criar plano',
    onSubmit: async (fechar) => {
      const v = f.ler();
      if (!v.turma_id || !v.disciplina_id) throw new Error('Escolha turma e disciplina.');
      const t = turmas.find((x) => x.id === v.turma_id);
      const vinculo = turmaDisc.find((x) => x.turma_id === v.turma_id && x.disciplina_id === v.disciplina_id);
      if (!vinculo) throw new Error('Essa disciplina não está vinculada à turma. Faça o vínculo em "Aulas por disciplina".');

      const entrada = editor.ler();
      const versoes = planos.filter((p) => p.turma_id === t.id && p.disciplina_id === v.disciplina_id);
      const versao = versoes.length ? Math.max(...versoes.map((p) => p.versao)) + 1 : 1;

      await inserir('planos_anuais', {
        turma_id: v.turma_id,
        disciplina_id: v.disciplina_id,
        ano: t.ano,
        versao,
        origem_id: v.origem_id || null,
        status: 'rascunho',
        conteudo: { entrada: { conteudos: entrada }, plano: null }
      });
      fechar();
      toast('Plano anual criado. Agora gere o conteúdo com IA.', 'ok');
      const area2 = document.getElementById('aba-conteudo');
      abaAnual(area2);
    }
  });
}

function abrirEditarAnual(plano, area) {
  const itens = plano.conteudo?.entrada?.conteudos || [];
  const editor = editorConteudos(itens);
  const aviso = el('<div class="aviso" style="margin-bottom:14px">Ao salvar, o plano anual é atualizado. Se ele já tinha conteúdo gerado, gere de novo com IA para refletir as mudanças.</div>');
  const conteudo = el('<div></div>');
  conteudo.append(aviso, editor.el);
  abrirModal({
    titulo: `Conteúdos · ${plano.disciplinas?.nome} (${plano.ano})`,
    conteudo,
    grande: true,
    onSubmit: async (fechar) => {
      const entrada = editor.ler();
      await atualizar('planos_anuais', plano.id, {
        conteudo: { ...(plano.conteudo || {}), entrada: { conteudos: entrada } },
        atualizado_em: new Date().toISOString()
      });
      fechar();
      toast('Conteúdos salvos.', 'ok');
      abaAnual(area);
    }
  });
}

// ---------- Aba 2: Mensal ----------
async function abaMensal(area) {
  const anuais = (await carregarAnuais()).filter((p) => p.conteudo?.plano || p.conteudo?.entrada?.conteudos?.length);
  if (!anuais.length) {
    area.innerHTML = '<div class="aviso azul">Crie um plano anual com conteúdos antes de gerar o mensal.</div>';
    return;
  }
  let mensais = await listar('planos_mensais', { select: '*', ordem: 'mes' });

  area.innerHTML = `
    <div class="filtros">
      <label class="campo" style="min-width:380px"><span>Plano anual</span>
        <select id="m-anual">${anuais.map((p) => `<option value="${p.id}">${esc(rotuloAnual(p))}</option>`).join('')}</select>
      </label>
      <label class="campo"><span>Mês</span>
        <select id="m-mes">${MESES_PLANEJAMENTO.map((m) => `<option value="${m}">${MESES[m - 1]}</option>`).join('')}</select>
      </label>
      <button class="btn primary" id="m-gerar" type="button">Gerar plano mensal</button>
    </div>
    <div id="m-resultado"></div>
    <div class="separador"></div>
    <h3 style="margin-bottom:10px">Planos mensais deste anual</h3>
    <div id="m-lista"></div>`;

  const selAnual = area.querySelector('#m-anual');
  const selMes = area.querySelector('#m-mes');
  const resultado = area.querySelector('#m-resultado');

  function mesmoAnual() { return anuais.find((p) => p.id === selAnual.value); }

  function mostrarLista() {
    const anual = mesmoAnual();
    const lista_ = mensais.filter((m) => m.plano_anual_id === anual.id);
    area.querySelector('#m-lista').innerHTML = lista_.length ? `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Mês</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>${lista_.map((m) => `<tr>
          <td>${MESES[m.mes - 1]}</td>
          <td>${tagStatus(m.status, STATUS_PLANO)}</td>
          <td class="acoes-linha"><button class="btn pequeno" data-mes-ver="${m.id}" type="button">Abrir</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum plano mensal gerado para este anual.</div>';
  }

  async function carregarItensMes() {
    const anual = mesmoAnual();
    const mes = Number(selMes.value);
    const trimestre = trimestreDoMes(mes);
    const itens = (anual.conteudo?.entrada?.conteudos || []).filter((c) => c.status !== 'removido');
    const existente = mensais.find((m) => m.plano_anual_id === anual.id && m.mes === mes);
    const ajustesSalvos = existente?.ajustes?.itens || {};
    const extrasSalvos = existente?.ajustes?.extras || [];

    resultado.innerHTML = `
      <div class="card">
        <div class="faixa" style="margin-bottom:16px">
          <div><strong>${MESES[mes - 1]}</strong> · ${NOMES_TRIMESTRE[trimestre]}</div>
          <div class="muted">Ajuste o que você conseguiu ou quer trabalhar. A IA gera o plano do mês e propõe a mudança no anual.</div>
        </div>
        ${itens.length ? `
        <div class="tabela-wrap" style="box-shadow:none"><table class="tabela">
          <thead><tr><th>Conteúdo do ano</th><th>Trimestre</th><th style="min-width:230px">O que fazer neste mês</th></tr></thead>
          <tbody>
            ${itens.map((c) => {
              const padrao = c.trimestre === trimestre ? 'trabalhar' : 'manter';
              const escolhido = ajustesSalvos[c.titulo] || padrao;
              return `<tr data-item="${esc(c.titulo)}">
                <td><strong>${esc(c.titulo)}</strong> ${c.observacao ? `<div class="small muted">${esc(c.observacao)}</div>` : ''}</td>
                <td>${c.trimestre}º</td>
                <td><select data-acao class="campo" style="width:100%">${Object.entries(ACAO_MES).map(([v, r]) => `<option value="${v}" ${v === escolhido ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
              </tr>`;
            }).join('')}
          </tbody></table></div>` : '<div class="aviso">Este plano anual não tem conteúdos cadastrados.</div>'}
        <label class="campo" style="margin-top:16px"><span>Conteúdos a mais para este mês (um por linha)</span>
          <textarea id="m-extras" placeholder="Ex.: Introdução a APIs REST">${esc(extrasSalvos.join('\n'))}</textarea>
          <span class="ajuda">Conteúdos que não estão no plano anual. A IA inclui e propõe a inclusão no anual.</span>
        </label>
        <div id="m-seletor"></div>
        <div class="acoes" style="margin-top:14px">
          <button class="btn primary" id="m-confirmar" type="button">Gerar plano de ${MESES[mes - 1]}</button>
        </div>
        ${existente?.conteudo?.conteudos ? `<div class="separador"></div><h3 style="margin-bottom:10px">Plano de ${MESES[mes - 1]}</h3>${renderMensal(existente.conteudo)}` : ''}
      </div>`;

    const seletor = await seletorMateriais({ disciplina: anual.disciplinas?.nome });
    resultado.querySelector('#m-seletor').replaceWith(seletor.el);

    resultado.querySelector('#m-confirmar').onclick = async () => {
      const acoes = {};
      resultado.querySelectorAll('tr[data-item]').forEach((tr) => { acoes[tr.dataset.item] = tr.querySelector('[data-acao]').value; });
      const extras = resultado.querySelector('#m-extras').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const { fonte_ids, observacoes } = seletor.ler();
      if (!fonte_ids.length) throw new Error('Marque ao menos um material na Base para a IA antes de gerar.');
      toast('Gerando o plano mensal com IA...', '');
      try {
        const resp = await invocarIA({ tipo: 'mensal', plano_anual_id: anual.id, mes, ajustes: { itens: acoes, extras }, fonte_ids, observacoes });
        toast('Plano mensal gerado. Revise a proposta para o anual.', 'ok');
        mensais = await listar('planos_mensais', { select: '*', ordem: 'mes' });
        if (resp?.proposta_anual) mostrarProposta(anual, resp.proposta_anual, area);
        else abaMensal(area);
      } catch (err) { mostrarErro(err); }
    };

    mostrarLista();
  }

  selAnual.onchange = () => { carregarItensMes(); };
  selMes.onchange = () => { carregarItensMes(); };
  area.querySelector('#m-gerar').onclick = () => { carregarItensMes(); };

  area.onclick = (e) => {
    const b = e.target.closest('[data-mes-ver]');
    if (!b) return;
    const m = mensais.find((x) => x.id === b.dataset.mesVer);
    selMes.value = String(m.mes);
    carregarItensMes();
  };

  carregarItensMes();
}

function renderMensal(plano) {
  return (plano.conteudos || []).map((c) => `
    <div class="plano-conteudo">
      <h4>${esc(c.titulo)} ${c.origem === 'extra' ? '<span class="tag laranja">a mais</span>' : ''}</h4>
      ${c.descricao ? `<p>${esc(c.descricao)}</p>` : ''}
      ${(c.topicos || []).length ? `<ul>${c.topicos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${(c.habilidades || []).length ? `<div class="rotulo-secao">Habilidades</div><div>${c.habilidades.map((h) => `<span class="tag azul" style="margin:2px">${esc(h)}</span>`).join(' ')}</div>` : ''}
      ${c.avaliacao ? `<div class="rotulo-secao">Avaliação</div><p>${esc(c.avaliacao)}</p>` : ''}
    </div>`).join('') + (plano.resumo ? `<div class="aviso verde">${esc(plano.resumo)}</div>` : '');
}

function mostrarProposta(anual, proposta, area) {
  const conteudo = el(`<div>
    <p>${esc(proposta.resumo || 'A IA sugere estas mudanças no plano anual.')}</p>
    <div class="dia-lista">
      ${(proposta.alteracoes || []).map((a) => `<div class="dia-item"><div><strong>${esc(a.titulo)}</strong><div class="small muted">${esc(a.motivo || '')}</div></div><span class="tag ${a.tipo === 'adicionar' ? 'verde' : a.tipo === 'remover' ? 'perigo' : 'azul'}">${esc(a.tipo)}</span></div>`).join('') || '<p class="muted">Nenhuma mudança.</p>'}
    </div>
    <div class="aviso">Aceitar cria uma <strong>nova versão</strong> do plano anual. Os planos mensais existentes desse anual serão marcados como desatualizados.</div>
  </div>`);
  abrirModal({
    titulo: 'Proposta de ajuste no plano anual',
    conteudo,
    submitLabel: 'Aplicar como nova versão',
    grande: true,
    onSubmit: async (fechar) => {
      const versoes = (await listar('planos_anuais', { select: 'versao', ordem: null, ajuste: (q) => q.eq('turma_id', anual.turma_id).eq('disciplina_id', anual.disciplina_id) }));
      const versao = Math.max(...versoes.map((v) => v.versao)) + 1;
      const [nova] = await inserir('planos_anuais', {
        turma_id: anual.turma_id,
        disciplina_id: anual.disciplina_id,
        ano: anual.ano,
        versao,
        origem_id: anual.id,
        status: 'rascunho',
        conteudo: { entrada: proposta.entrada || anual.conteudo.entrada, plano: anual.conteudo.plano || null }
      });
      await supabase.from('planos_mensais').update({ status: 'desatualizado' }).eq('plano_anual_id', anual.id);
      fechar();
      toast(`Nova versão v${versao} criada no anual.`, 'ok');
      abaMensal(area);
      return nova;
    }
  });
}

// ---------- Aba 3: Diário ----------
async function abaDiario(area) {
  const mensais = await listar('planos_mensais', {
    select: '*, planos_anuais(id, ano, turma_id, disciplina_id, turmas(nome, colegio_id, colegios(nome)), disciplinas(nome))',
    ordem: 'mes'
  });
  if (!mensais.length) {
    area.innerHTML = '<div class="aviso azul">Gere um plano mensal antes. O diário sai do mensal.</div>';
    return;
  }

  area.innerHTML = `
    <div class="filtros">
      <label class="campo" style="min-width:420px"><span>Plano mensal</span>
        <select id="d-mensal">${mensais.map((m) => `<option value="${m.id}">${esc(`${m.planos_anuais?.turmas?.colegios?.nome || ''} · ${m.planos_anuais?.turmas?.nome || ''} · ${m.planos_anuais?.disciplinas?.nome || ''} · ${MESES[m.mes - 1]} ${m.planos_anuais?.ano || ''}`)}</option>`).join('')}</select>
      </label>
    </div>
    <div id="d-conteudo"></div>`;

  const sel = area.querySelector('#d-mensal');
  sel.onchange = () => carregarDiario(area, mensais.find((m) => m.id === sel.value)).catch(mostrarErro);
  await carregarDiario(area, mensais[0]);
}

async function carregarDiario(area, mensal) {
  const alvo = area.querySelector('#d-conteudo');
  alvo.innerHTML = carregando('Calculando os dias letivos...');
  const anual = await listar('planos_anuais', { select: 'id, ano, turma_id, disciplina_id, turmas(colegio_id), disciplinas(nome)', ordem: null, ajuste: (q) => q.eq('id', mensal.plano_anual_id) });
  const p = anual[0];
  const colegioId = p.turmas?.colegio_id;

  const [eventos, vinculo, meta, diarios] = await Promise.all([
    listar('calendario_eventos', {
      select: '*, evento_colegios(colegio_id)',
      ordem: 'data',
      ajuste: (q) => q.gte('data', `${p.ano}-01-01`).lte('data', `${p.ano}-12-31`)
    }),
    listar('turma_disciplinas', { select: 'aulas_semana', ordem: null, ajuste: (q) => q.eq('turma_id', p.turma_id).eq('disciplina_id', p.disciplina_id) }),
    getConfig('dias_letivos_ano', DIAS_LETIVOS_PADRAO),
    listar('planos_diarios', { ordem: 'data', ajuste: (q) => q.eq('plano_mensal_id', mensal.id) })
  ]);

  const eventosMapeados = eventos.map((e) => ({ ...e, colegios: (e.evento_colegios || []).map((x) => x.colegio_id) }));
  const letivosAno = diasLetivos(diasDoAno(p.ano), eventosMapeados, colegioId).map((d) => d.data);
  const aulasSemana = vinculo[0]?.aulas_semana || 0;
  const aulasMapa = aulasPorDia(letivosAno, aulasSemana);
  const doMes = diasDoMes(p.ano, mensal.mes).filter((d) => letivosAno.includes(d) && aulasMapa.has(d));
  const diasNaoLetivos = diasDoMes(p.ano, mensal.mes).filter((d) => !letivosAno.includes(d));
  const diariosPorData = Object.fromEntries(diarios.map((d) => [d.data, d]));
  const totalAulas = doMes.reduce((s, d) => s + aulasMapa.get(d), 0);

  if (!aulasSemana) {
    alvo.innerHTML = '<div class="aviso">Esta turma não tem aulas por semana cadastradas para a disciplina. Cadastre em "Aulas por disciplina".</div>';
    return;
  }

  alvo.innerHTML = `
    <div class="grid kpis" style="margin-bottom:16px">
      <div class="card kpi"><div class="rotulo">Dias de aula no mês</div><div class="valor">${doMes.length}</div><div class="sub">${diasNaoLetivos.length} dia(s) sem aula</div></div>
      <div class="card kpi azul"><div class="rotulo">Aulas no mês</div><div class="valor">${totalAulas}</div><div class="sub">${aulasSemana} aula(s) por semana</div></div>
      <div class="card kpi marinho"><div class="rotulo">Diários gerados</div><div class="valor">${diarios.length}</div><div class="sub">de ${doMes.length} dias</div></div>
    </div>
    <div id="d-seletor"></div>
    <div class="acoes" style="justify-content:space-between;margin-bottom:12px">
      <p class="muted" style="margin:0">Feriados e eventos sem aula não entram. As aulas da semana são distribuídas pelos dias letivos.</p>
      <button class="btn primary" id="d-gerar" type="button">Gerar diários do mês</button>
    </div>
    <div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Data</th><th>Dia</th><th>Aulas</th><th>Situação</th><th></th></tr></thead>
      <tbody>
        ${doMes.map((d) => {
          const existe = diariosPorData[d];
          return `<tr>
            <td>${d.slice(8)}/${d.slice(5, 7)}</td>
            <td>${DIAS_SEMANA[diaSemanaDe(d)]}</td>
            <td>${aulasMapa.get(d)}</td>
            <td>${existe ? tagStatus(existe.status, STATUS_PLANO) : '<span class="tag">pendente</span>'}</td>
            <td class="acoes-linha">${existe ? `<button class="btn pequeno" data-diario="${existe.id}" type="button">Ver prática</button>` : ''}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>`;

  const seletor = await seletorMateriais({ disciplina: p.disciplinas?.nome });
  alvo.querySelector('#d-seletor').replaceWith(seletor.el);

  alvo.querySelector('#d-gerar').onclick = async () => {
    if (!doMes.length) return toast('Não há dias letivos neste mês.', 'erro');
    toast('Gerando os planos diários com IA...', '');
    try {
      const { fonte_ids, observacoes } = seletor.ler();
      if (!fonte_ids.length) throw new Error('Marque ao menos um material na Base para a IA antes de gerar.');
      await invocarIA({
        tipo: 'diario',
        plano_mensal_id: mensal.id,
        dias: doMes.map((d) => ({ data: d, aulas: aulasMapa.get(d) })),
        fonte_ids,
        observacoes
      });
      toast('Planos diários gerados.', 'ok');
      carregarDiario(area, mensal);
    } catch (err) { mostrarErro(err); }
  };

  alvo.onclick = async (e) => {
    const b = e.target.closest('[data-diario]');
    if (!b) return;
    const d = diarios.find((x) => x.id === b.dataset.diario);
    const pratica = d.pratica_docente || d.conteudo?.pratica_docente;
    const corpo = el(`<div>
      <h3 style="margin-bottom:8px">Conteúdo do dia</h3>
      <p>${esc(d.conteudo?.conteudo || d.conteudo?.resumo || '')}</p>
      ${(d.conteudo?.topicos || []).length ? `<ul>${d.conteudo.topicos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="pratica"><strong>Prática docente</strong>
        <p style="margin-top:6px">${esc(typeof pratica === 'string' ? pratica : pratica?.descricao || '')}</p>
        ${pratica?.passos ? `<ol>${pratica.passos.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      </div>
    </div>`);
    abrirModal({ titulo: `Aula de ${d.data.slice(8)}/${d.data.slice(5, 7)}`, conteudo: corpo, grande: true });
  };
}
