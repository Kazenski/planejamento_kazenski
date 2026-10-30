// Gera planos anual, mensal e diário com IA (Gemini).
// A chave GEMINI_API_KEY fica em segredo do Supabase. Nunca vai para o navegador.
// As gravações usam o token do próprio usuário, então o RLS continua valendo.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MODELO = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';

// Embedding de uma consulta (RETRIEVAL_QUERY), normalizado, para buscar nos trechos dos materiais.
async function embedConsulta(texto: string): Promise<number[]> {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) throw new Error('A chave da IA não está configurada no Supabase (GEMINI_API_KEY).');
  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      content: { parts: [{ text: texto.slice(0, 6000) }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768
    })
  });
  if (!resp.ok) throw new Error(`O serviço de embeddings respondeu com erro ${resp.status}.`);
  const dados = await resp.json();
  const v: number[] = dados.embedding.values;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// Monta o bloco extra do prompt: observações do professor e trechos dos materiais escolhidos.
// Sem materiais escolhidos, nada é lido nem consultado (sem custo extra).
const LIMITE_ORIENTADOR = 120000;

// Orientadores do curso (ex.: matriz de conteúdos): entram inteiros, em ordem, sem depender da busca.
async function orientadoresDoCurso(db: any, cursoId: string | null | undefined): Promise<string> {
  if (!cursoId) return '';
  const { data: fontes } = await db.from('fontes_material').select('id, nome')
    .eq('curso_id', cursoId).eq('orientador', true).eq('status', 'indexado');
  if (!fontes?.length) return '';
  const ids = fontes.map((f: any) => f.id);
  const nomes = new Map(fontes.map((f: any) => [f.id, f.nome]));
  const { data: trechos } = await db.from('material_trechos')
    .select('fonte_id, pagina, conteudo, ordem').in('fonte_id', ids).order('fonte_id').order('ordem').limit(5000);
  let txt = 'ORIENTAÇÕES OBRIGATÓRIAS DO CURSO (matriz de conteúdos por disciplina: siga-as ao planejar)\n';
  let usado = txt.length;
  for (const t of trechos ?? []) {
    const bloco = `[${nomes.get(t.fonte_id) ?? 'orientação'}${t.pagina ? `, p. ${t.pagina}` : ''}] ${t.conteudo}\n---\n`;
    if (usado + bloco.length > LIMITE_ORIENTADOR) {
      txt += '\n[trecho omitido: o material do curso é maior que o limite de contexto]\n';
      break;
    }
    txt += bloco;
    usado += bloco.length;
  }
  return txt + '\n';
}

async function materiaisParaPrompt(db: any, corpo: any, consultaTexto: string, cursoId?: string | null): Promise<string> {
  const fonteIds: string[] = Array.isArray(corpo.fonte_ids) ? corpo.fonte_ids : [];
  const obs = String(corpo.observacoes || '').trim();
  let txt = await orientadoresDoCurso(db, cursoId);
  if (obs) txt += `OBSERVAÇÕES DO PROFESSOR (considere ao planejar)\n${obs}\n\n`;
  if (fonteIds.length && consultaTexto.trim()) {
    const vetor = await embedConsulta(consultaTexto);
    const { data: trechos, error } = await db.rpc('buscar_trechos', {
      consulta: JSON.stringify(vetor),
      fontes: fonteIds,
      limite: 30
    });
    if (error) throw new Error(`Erro ao buscar nos materiais: ${error.message}`);
    const { data: fontes } = await db.from('fontes_material').select('id, nome').in('id', fonteIds);
    const nomes = new Map((fontes ?? []).map((f: any) => [f.id, f.nome]));
    if (trechos?.length) {
      txt += 'TRECHOS DOS MATERIAIS ESCOLHIDOS PELO PROFESSOR (use como referência e cite entre colchetes, ex.: [nome do material, p. X])\n';
      txt += trechos.map((t: any) => `[${nomes.get(t.fonte_id) ?? 'material'}, p. ${t.pagina ?? '-'}] ${t.conteudo}`).join('\n---\n');
      txt += '\n\n';
    }
  }
  return txt;
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function gemini(prompt: string): Promise<any> {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) throw new Error('A chave da IA não está configurada no Supabase (GEMINI_API_KEY).');
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
    })
  });
  if (!resp.ok) throw new Error(`A IA respondeu com erro ${resp.status}. Tente novamente em instantes.`);
  const dados = await resp.json();
  const texto = dados.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error('A IA devolveu um formato inválido. Tente gerar novamente.');
  }
}

const REGRAS_BASE = `
Você é um especialista em planejamento de Educação Profissional Técnica de nível médio.
Adapte o planejamento ao curso, à série e às particularidades da turma informados no contexto. Cada turma é única.
Escreva sempre em português do Brasil, com linguagem objetiva e prática para o professor adaptar ao documento do colégio.
Use como referências os materiais escolhidos pelo professor e o catálogo de habilidades informado. Só cite códigos de habilidade que estiverem na lista fornecida. Se nenhum código se aplicar, deixe a lista vazia. Não invente códigos.
Responda SOMENTE com JSON válido, no formato pedido.`;

function listaHabilidades(habs: any[]) {
  return habs.length ? habs.map((h) => `${h.codigo}: ${h.descricao || ''}`).join('\n') : '(catálogo de habilidades ainda não cadastrado)';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }
    });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ erro: 'Sessão expirada. Entre novamente.' }, 401);

    const corpo = await req.json();
    const habilidades = (await db.from('habilidades').select('id, codigo, descricao')).data ?? [];
    const materiais = (await db.from('fontes_material').select('nome, categoria')).data ?? [];

    if (corpo.tipo === 'anual') return json(await gerarAnual(db, user.id, corpo.plano_id, habilidades, materiais, corpo));
    if (corpo.tipo === 'mensal') return json(await gerarMensal(db, user.id, corpo, habilidades, materiais));
    if (corpo.tipo === 'diario') return json(await gerarDiario(db, user.id, corpo, habilidades));
    return json({ erro: 'Tipo de planejamento inválido.' }, 400);
  } catch (err) {
    return json({ erro: (err as Error).message || 'Erro inesperado.' }, 500);
  }
});

async function registrarGeracao(db: any, userId: string, tipo: string, entrada: unknown, saida: unknown) {
  await db.from('geracoes_ia').insert({ user_id: userId, tipo, entrada, saida, modelo: MODELO });
}

async function vincularHabilidades(db: any, userId: string, planoId: string, codigos: string[], habilidades: any[]) {
  const mapa = new Map(habilidades.map((h) => [h.codigo, h.id]));
  const ids = [...new Set(codigos.map((c) => mapa.get(c)).filter(Boolean))];
  await db.from('planos_anuais_habilidades').delete().eq('plano_anual_id', planoId);
  if (ids.length) {
    await db.from('planos_anuais_habilidades').insert(ids.map((habilidade_id) => ({ user_id: userId, plano_anual_id: planoId, habilidade_id })));
  }
}

async function carregarAnual(db: any, planoId: string) {
  const { data, error } = await db.from('planos_anuais')
    .select('*, turmas(nome, ano, serie, curso, curso_id, qtd_alunos, observacoes, colegios(nome)), disciplinas(nome)')
    .eq('id', planoId).single();
  if (error || !data) throw new Error('Plano anual não encontrado.');
  const { data: vinc } = await db.from('turma_disciplinas').select('aulas_semana')
    .eq('turma_id', data.turma_id).eq('disciplina_id', data.disciplina_id).maybeSingle();
  return { ...data, aulas_semana: vinc?.aulas_semana ?? null };
}

async function gerarAnual(db: any, userId: string, planoId: string, habilidades: any[], materiais: any[], corpo: any) {
  const plano = await carregarAnual(db, planoId);
  const entrada = (plano.conteudo?.entrada?.conteudos || []).filter((c: any) => c.status !== 'removido');
  if (!entrada.length) throw new Error('Cadastre os conteúdos do ano antes de gerar.');

  const extra = await materiaisParaPrompt(db, corpo, entrada.map((c: any) => `${c.titulo}${c.observacao ? ': ' + c.observacao : ''}`).join('\n'), plano.turmas?.curso_id);
  const prompt = `${REGRAS_BASE}

TAREFA: criar o PLANO ANUAL detalhado da disciplina, para um professor adaptar ao documento do colégio.

CONTEXTO
- Colégio: ${plano.turmas?.colegios?.nome}
- Curso: ${plano.turmas?.curso} · Série: ${plano.turmas?.serie}º ano · Turma: ${plano.turmas?.nome} · Ano letivo: ${plano.ano}
- Particularidades da turma: ${plano.turmas?.observacoes || 'nenhuma informada'}
- Disciplina: ${plano.disciplinas?.nome}
- Alunos: ${plano.turmas?.qtd_alunos ?? 'não informado'} (somente para cabeçalho)
- Aulas por semana: ${plano.aulas_semana ?? 'não informado'}
- Materiais-base cadastrados: ${materiais.filter((m: any) => m.categoria === 'material_base').map((m: any) => m.nome).join('; ') || 'nenhum'}
- Modelos do colégio cadastrados: ${materiais.filter((m: any) => m.categoria === 'modelo').map((m: any) => m.nome).join('; ') || 'nenhum'}

CONTEÚDOS DO ANO (use todos, na ordem e no trimestre indicados)
${entrada.map((c: any) => `- [${c.trimestre}º trimestre] ${c.titulo}${c.observacao ? ` (obs.: ${c.observacao})` : ''} (situação: ${c.status})`).join('\n')}

${extra}CATÁLOGO DE HABILIDADES (código: descrição)
${listaHabilidades(habilidades)}

FORMATO DO JSON:
{
  "trimestres": [
    {
      "numero": 1,
      "titulo": "...",
      "objetivos": ["..."],
      "conteudos": [
        {
          "titulo": "...",
          "descricao": "...",
          "topicos": ["tópicos detalhados, prontos para o professor adaptar"],
          "habilidades": ["código do catálogo"],
          "materiais": ["material de apoio ou referência"],
          "avaliacao": "forma de avaliação sugerida",
          "aulas_estimadas": 4
        }
      ]
    }
  ],
  "observacoes": "resumo de como o ano foi distribuído e pontos de atenção"
}`;

  const saida = await gemini(prompt);
  const planoGerado = { ...saida, cabecalho: {
    colegio: plano.turmas?.colegios?.nome, turma: plano.turmas?.nome, serie: plano.turmas?.serie,
    curso: plano.turmas?.curso, alunos: plano.turmas?.qtd_alunos, ano: plano.ano,
    disciplina: plano.disciplinas?.nome, aulas_semana: plano.aulas_semana
  } };

  const codigos = (saida.trimestres || []).flatMap((t: any) => (t.conteudos || []).flatMap((c: any) => c.habilidades || []));
  await db.from('planos_anuais').update({
    conteudo: { ...plano.conteudo, plano: planoGerado },
    status: 'gerado',
    atualizado_em: new Date().toISOString()
  }).eq('id', planoId);
  await vincularHabilidades(db, userId, planoId, codigos, habilidades);
  await registrarGeracao(db, userId, 'anual', { plano_id: planoId }, planoGerado);
  return { ok: true, plano: planoGerado };
}

async function gerarMensal(db: any, userId: string, corpo: any, habilidades: any[], materiais: any[]) {
  const anual = await carregarAnual(db, corpo.plano_anual_id);
  const mes = Number(corpo.mes);
  const ajustes = corpo.ajustes || { itens: {}, extras: [] };
  const entradaAtual: any[] = anual.conteudo?.entrada?.conteudos || [];
  const planoAnual = anual.conteudo?.plano;
  if (!planoAnual) throw new Error('Gere primeiro o plano anual com IA.');

  // Decisões de inclusão/remoção são aplicadas no código, não pela IA.
  const acoes: Record<string, string> = ajustes.itens || {};
  const trabalhar = entradaAtual.filter((c) => c.status !== 'removido' && (acoes[c.titulo] === 'trabalhar'));
  const remover = entradaAtual.filter((c) => acoes[c.titulo] === 'remover');
  const adiar = entradaAtual.filter((c) => acoes[c.titulo] === 'adiar');
  const extras: string[] = ajustes.extras || [];

  const propostaEntrada = entradaAtual.map((c) => {
    if (acoes[c.titulo] === 'remover') return { ...c, status: 'removido' };
    return c;
  });
  for (const e of extras) {
    const existe = propostaEntrada.some((c) => c.titulo.toLowerCase() === e.toLowerCase());
    if (!existe) propostaEntrada.push({ titulo: e, trimestre: TRIMESTRE_DO_MES(mes), status: 'novo', observacao: `Incluído para ${mes}/${anual.ano}` });
  }

  const extra = await materiaisParaPrompt(db, corpo, [...trabalhar.map((c: any) => c.titulo), ...extras].join('\n'), anual.turmas?.curso_id);
  const prompt = `${REGRAS_BASE}

TAREFA: criar o PLANO MENSAL de ${mes}/${anual.ano}, como recorte do plano anual. Mantenha coerência com o anual e com o que o professor marcou.

CONTEXTO
- Curso: ${anual.turmas?.curso} · Série: ${anual.turmas?.serie}º ano · Turma: ${anual.turmas?.nome}
- Particularidades da turma: ${anual.turmas?.observacoes || 'nenhuma informada'}
- Disciplina: ${anual.disciplinas?.nome}

PLANO ANUAL (fonte da verdade)
${JSON.stringify(planoAnual.trimestres || [])}

AJUSTES DO PROFESSOR PARA ESTE MÊS
- Trabalhar neste mês: ${trabalhar.map((c) => c.titulo).join('; ') || 'nenhum'}
- Adiar para o próximo mês: ${adiar.map((c) => c.titulo).join('; ') || 'nenhum'}
- Remover do ano: ${remover.map((c) => c.titulo).join('; ') || 'nenhum'}
- Conteúdos a mais (não estão no anual): ${extras.join('; ') || 'nenhum'}

${extra}CATÁLOGO DE HABILIDADES (código: descrição)
${listaHabilidades(habilidades)}

FORMATO DO JSON:
{
  "resumo": "resumo do mês em 2 ou 3 frases",
  "conteudos": [
    {
      "titulo": "...",
      "origem": "anual ou extra",
      "descricao": "...",
      "topicos": ["..."],
      "habilidades": ["código do catálogo"],
      "avaliacao": "..."
    }
  ]
}`;

  const saida = await gemini(prompt);
  const mudancas = [
    ...trabalhar.map((c) => ({ tipo: 'manter', titulo: c.titulo, motivo: 'Trabalhado neste mês.' })),
    ...adiar.map((c) => ({ tipo: 'adiar', titulo: c.titulo, motivo: 'Adiado para o próximo mês.' })),
    ...remover.map((c) => ({ tipo: 'remover', titulo: c.titulo, motivo: 'Removido do ano.' })),
    ...extras.map((t) => ({ tipo: 'adicionar', titulo: t, motivo: 'Conteúdo a mais incluído no anual.' }))
  ];

  const { data: existente } = await db.from('planos_mensais').select('id').eq('plano_anual_id', anual.id).eq('mes', mes).maybeSingle();
  const gravado = {
    user_id: userId, plano_anual_id: anual.id, mes,
    conteudo: { resumo: saida.resumo, conteudos: saida.conteudos || [] },
    ajustes: { itens: acoes, extras },
    status: 'gerado', atualizado_em: new Date().toISOString()
  };
  if (existente) await db.from('planos_mensais').update(gravado).eq('id', existente.id);
  else await db.from('planos_mensais').insert(gravado);

  const proposta = { resumo: 'A proposta abaixo muda o plano anual. Confira antes de aplicar.', alteracoes: mudancas, entrada: propostaEntrada };
  await registrarGeracao(db, userId, 'mensal', { plano_anual_id: anual.id, mes, ajustes }, { resumo: saida.resumo });
  return { ok: true, plano: gravado.conteudo, proposta_anual: mudancas.length ? proposta : null };
}

function TRIMESTRE_DO_MES(mes: number) {
  if (mes <= 4) return 1;
  if (mes <= 8) return 2;
  return 3;
}

async function gerarDiario(db: any, userId: string, corpo: any, habilidades: any[]) {
  const { data: mensal, error } = await db.from('planos_mensais')
    .select('*, planos_anuais(id, ano, conteudo, turma_id, disciplina_id, turmas(nome, serie, curso, curso_id, observacoes, colegios(nome)), disciplinas(nome))')
    .eq('id', corpo.plano_mensal_id).single();
  if (error || !mensal) throw new Error('Plano mensal não encontrado.');
  const dias: { data: string; aulas: number }[] = corpo.dias || [];
  if (!dias.length) throw new Error('Nenhum dia letivo informado.');
  const pa = mensal.planos_anuais;

  const extra = await materiaisParaPrompt(db, corpo, (mensal.conteudo?.conteudos || []).map((c: any) => c.titulo).join('\n'), pa.turmas?.curso_id);
  const prompt = `${REGRAS_BASE}

TAREFA: criar o PLANO DIÁRIO de cada dia letivo abaixo. Cada dia traz o conteúdo da aula e a PRÁTICA DOCENTE: como o professor conduz a aula (organização, atividades, passos, recursos e forma de checar a aprendizagem).

CONTEXTO
- Colégio: ${pa.turmas?.colegios?.nome} · Turma: ${pa.turmas?.nome} · Disciplina: ${pa.disciplinas?.nome}
- Curso: ${pa.turmas?.curso} · Série: ${pa.turmas?.serie}º ano
- Particularidades da turma: ${pa.turmas?.observacoes || 'nenhuma informada'}
- Plano mensal (resumo): ${mensal.conteudo?.resumo || ''}
- Conteúdos do mês: ${JSON.stringify(mensal.conteudo?.conteudos || [])}

DIAS LETIVOS (data e número de aulas)
${dias.map((d) => `- ${d.data}: ${d.aulas} aula(s)`).join('\n')}

${extra}CATÁLOGO DE HABILIDADES (código: descrição)
${listaHabilidades(habilidades)}

FORMATO DO JSON:
{
  "dias": [
    {
      "data": "AAAA-MM-DD",
      "conteudo": "o que será ensinado no dia",
      "topicos": ["..."],
      "pratica_docente": {
        "descricao": "resumo da prática",
        "passos": ["passo 1", "passo 2"],
        "recursos": ["..."],
        "checagem": "como verificar a aprendizagem"
      }
    }
  ]
}`;

  const saida = await gemini(prompt);
  const porData = new Map((saida.dias || []).map((d: any) => [d.data, d]));
  const linhas = dias.map((d) => {
    const g: any = porData.get(d.data) || {};
    return {
      user_id: userId,
      plano_mensal_id: mensal.id,
      data: d.data,
      aula_numero: 1,
      conteudo: { aulas: d.aulas, conteudo: g.conteudo || '', topicos: g.topicos || [], pratica_docente: g.pratica_docente || null },
      pratica_docente: g.pratica_docente?.descricao || null,
      status: 'gerado'
    };
  });
  const { error: erroGravar } = await db.from('planos_diarios').upsert(linhas, { onConflict: 'plano_mensal_id,data,aula_numero' });
  if (erroGravar) throw new Error(erroGravar.message);
  await registrarGeracao(db, userId, 'diario', { plano_mensal_id: mensal.id, dias: dias.length }, { total: linhas.length });
  return { ok: true, total: linhas.length };
}
