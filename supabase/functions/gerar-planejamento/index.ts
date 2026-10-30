// Gera planos anual, mensal e diário com IA (Gemini).
// A chave GEMINI_API_KEY fica em segredo do Supabase. Nunca vai para o navegador.
// As gravações usam o token do próprio usuário, então o RLS continua valendo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';
import { getDocumentProxy, extractText } from 'npm:unpdf@1';

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
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 32768 }
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
    const materiais = (await db.from('fontes_material').select('id, nome, categoria')).data ?? [];

    if (corpo.tipo === 'anual') return json(await gerarAnual(db, user.id, corpo.plano_id, habilidades, materiais, { ...corpo, professor: user.user_metadata?.full_name || user.email }));
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
    .select('*, turmas(nome, ano, serie, curso, curso_id, qtd_alunos, observacoes, colegios(nome), cursos(nome)), disciplinas(nome)')
    .eq('id', planoId).single();
  if (error || !data) throw new Error('Plano anual não encontrado.');
  const { data: vinc } = await db.from('turma_disciplinas').select('aulas_semana')
    .eq('turma_id', data.turma_id).eq('disciplina_id', data.disciplina_id).maybeSingle();
  return { ...data, aulas_semana: vinc?.aulas_semana ?? null };
}

// Modelo genérico de planejamento anual do colégio (Modelo de Planejamento Anual - Disciplina). Base obrigatória do plano anual.
const MODELO_SECOES = `SEÇÕES OBRIGATÓRIAS DO MODELO (preencha todas, nesta ordem):
I. Identificação da disciplina: série/ano, componente curricular, nº de aulas semanais, turma(s), ano letivo.
II. Professor responsável.
III. Competências gerais do componente curricular.
IV. Organização dos conteúdos do 1º trimestre: unidade temática, objeto do conhecimento, habilidades (códigos do catálogo), metodologia/estratégia.
V. Organização dos conteúdos do 2º trimestre: mesmas colunas.
VI. Organização dos conteúdos do 3º trimestre: mesmas colunas.
VII. Recomposição das aprendizagens: unidade temática, objeto do conhecimento, habilidades, metodologia/estratégia.
VIII. Projetos integradores: temas, tema específico, habilidades da macroárea, metodologia/estratégia, atividades desenvolvidas no projeto.
IX. Temas curriculares transversais: competências gerais, competências específicas, habilidades da macroárea, metodologia/estratégia.
X. Avaliações e critérios avaliativos: instrumentos de avaliação e critérios de correção.
XI. Referências: bibliografias que serão usadas ao longo do ano.`;

// Competências de eixo fixas do colégio (do plano de referência). Copie o texto exato quando se aplicar à disciplina.
const COMPETENCIAS_EIXO = `COMPETÊNCIAS DE EIXO FIXO DO COLÉGIO (use as que se aplicam à disciplina, com o texto exato):
CULTURA DIGITAL
- CDEM01: Propor ações criativas que contribuam para a transformação da sociedade, analisando e utilizando as tecnologias de forma crítica, considerando os diferentes tipos de mídia e as relações humanas mediadas por elas.
- CDEM02: Analisar a relação tecnologia e sociedade, avaliando suas potencialidades e riscos, considerando a ética, a sustentabilidade e o empreendedorismo, a fim de atuar no mundo de forma responsável.
- CDEMAD01: Produzir conhecimento e conteúdo com base nos multiletramentos, por meio de sinais verbais e não verbais, códigos, a fim de utilizar os recursos digitais e a internet em seu cotidiano.
- CDEMSD01: Identificar e aplicar técnicas de proteção e segurança digital de informações, principalmente relacionadas ao uso da internet.
- CDEMAT01: Analisar a relação homem-máquina, considerando a dimensão social, política, econômica e ambiental.
- CDEMLM01: Utilizar diferentes mídias para a comunicação, agindo de forma crítica e ética na produção e consumo de informação.
- CDEMET01: Desenvolver soluções inovadoras utilizando tecnologias para resolver problemas.
- CDEMDE01: Criar materiais gráficos utilizando diferentes softwares de diagramação e editoração no desenvolvimento de projetos.
TECNOLOGIA DIGITAL
- TDEM01: Compreender as bases das tecnologias digitais atuais, como hardware, software, redes e representação de dados, refletindo sobre as tendências tecnológicas e seus impactos na sociedade.
- TDEM02: Utilizar de forma segura, propositiva e intencional as ferramentas tecnológicas digitais para se expressar em ambientes físicos ou digitais.
- TDEMTT01: Analisar a relação entre tecnologia e o trabalho no século XXI, considerando impactos e transformações sociais, econômicas e políticas.
- TDEMCC01: Analisar a segurança digital de dados e suas aplicações e implicações na privacidade, proteção de dados pessoais e segurança digital.
- TDEMIA01: Criar e utilizar aplicações de Inteligência Artificial e suas tecnologias subjacentes, refletindo sobre os impactos sociais, culturais e ambientais desta tecnologia em cenários de utilização.
PENSAMENTO COMPUTACIONAL
- PCEM01: Representar problemas complexos na forma de problemas menores, reconhecendo os seus detalhes relevantes e projetar soluções na forma de sequências de passos simples, coerentes e não ambíguos capazes de serem executados por computadores.
- PCEM02: Analisar os dados relevantes de um problema e representá-los em formatos que possam ser inseridos em um computador para serem posteriormente analisados, manipulados e visualizados de modo a se extrair informações, conhecimentos e conclusões.
- PCEM03: Compreender os processos e tecnologias envolvidas no desenvolvimento de programas para computadores, incluindo computadores pessoais, dispositivos móveis e aplicações na Web, a fim de utilizar estas soluções tecnológicas de maneira segura e responsável, avaliando seus riscos e benefícios.
- PCEMPC01: Resolver problemas por meio do desenvolvimento de algoritmos e implementá-los em linguagens de programação textual.
- PCEMCD01: Coletar, organizar, visualizar e interpretar conjuntos de dados para extração de informações, conhecimentos, criações de previsões que apoiem a tomada de decisão.`;

// Lê o texto de um documento enviado pelo professor (DOCX, PDF ou TXT), do Storage do próprio usuário.
async function textoDeArquivo(db: any, caminho: string, nome: string): Promise<string> {
  const { data: arquivo, error } = await db.storage.from('materiais').download(caminho);
  if (error || !arquivo) throw new Error('Não foi possível ler o documento enviado.');
  const buf = await arquivo.arrayBuffer();
  const ext = String(nome || '').toLowerCase().split('.').pop();
  let texto = '';
  if (ext === 'docx') {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    texto = xml.replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  } else if (ext === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    texto = String(text);
  } else {
    texto = new TextDecoder().decode(buf);
  }
  return texto.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}

// Competências gerais da BNCC, como constam no Currículo Base do Ensino Médio do Território Catarinense (Caderno 1, pp. 42-43).
const COMPETENCIAS_BNCC = `COMPETÊNCIAS GERAIS DA BNCC (texto do CBTC, use como referência para a seção III, projetos e temas transversais):
1. Valorizar e utilizar os conhecimentos historicamente construídos sobre o mundo físico, social, cultural e digital para entender e explicar a realidade, continuar aprendendo e colaborar para a construção de uma sociedade justa, democrática e inclusiva.
2. Exercitar a curiosidade intelectual e recorrer à abordagem própria das ciências, incluindo a investigação, a reflexão, a análise crítica, a imaginação e a criatividade, para investigar causas, elaborar e testar hipóteses, formular e resolver problemas e criar soluções (inclusive tecnológicas) com base nos conhecimentos das diferentes áreas.
3. Valorizar e fruir as diversas manifestações artísticas e culturais, das locais às mundiais, e também participar de práticas diversificadas da produção artístico-cultural.
4. Utilizar diferentes linguagens – verbal, corporal, visual, sonora e digital –, bem como os conhecimentos das linguagens artística, matemática e científica, para se expressar e partilhar informações, experiências, ideias e sentimentos em diferentes contextos e produzir sentidos que levem ao entendimento mútuo.
5. Compreender, utilizar e criar tecnologias digitais de informação e comunicação de forma crítica, significativa, reflexiva e ética nas diversas práticas sociais (incluindo as escolares) para se comunicar, acessar e disseminar informações, produzir conhecimentos, resolver problemas e exercer protagonismo e autoria na vida pessoal e coletiva.
6. Valorizar a diversidade de saberes e vivências culturais e apropriar-se de conhecimentos e experiências que lhe possibilitem entender as relações próprias do mundo do trabalho e fazer escolhas alinhadas ao exercício da cidadania e ao seu projeto de vida, com liberdade, autonomia, consciência crítica e responsabilidade.
7. Argumentar com base em fatos, dados e informações confiáveis, para formular, negociar e defender ideias, pontos de vista e decisões comuns que respeitem e promovam os direitos humanos, a consciência socioambiental e o consumo responsável em âmbito local, regional e global, com posicionamento ético em relação ao cuidado de si mesmo, dos outros e do planeta.
8. Conhecer-se, apreciar-se e cuidar de sua saúde física e emocional, compreendendo-se na diversidade humana e reconhecendo suas emoções e as dos outros, com autocrítica e capacidade para lidar com elas.
9. Exercitar a empatia, o diálogo, a resolução de conflitos e a cooperação, fazendo-se respeitar e promovendo o respeito ao outro e aos direitos humanos, com acolhimento e valorização da diversidade de indivíduos e de grupos sociais, seus saberes, identidades, culturas e potencialidades, sem preconceitos de qualquer natureza.
10. Agir pessoal e coletivamente com autonomia, responsabilidade, flexibilidade, resiliência e determinação, tomando decisões com base em princípios éticos, democráticos, inclusivos, sustentáveis e solidários.`;

// Habilidades gerais dos eixos estruturantes (CBTC, Quadro 3). Texto de referência, sem códigos.
const EIXOS_CBTC = `HABILIDADES DOS EIXOS ESTRUTURANTES (CBTC, Quadro 3, texto de referência para projetos integradores e temas transversais):
- Investigação científica: identificar, selecionar, processar e analisar dados, fatos e evidências com curiosidade, atenção, criticidade e ética; posicionar-se com base em critérios científicos, éticos e estéticos; utilizar informações e ideias de investigações científicas para criar ou propor soluções para problemas diversos.
- Processos criativos: reconhecer e analisar manifestações criativas, artísticas e culturais; questionar, modificar e adaptar ideias existentes e criar propostas, obras ou soluções criativas, originais ou inovadoras; difundir novas ideias, propostas ou soluções por diferentes linguagens, mídias e plataformas.
- Mediação e intervenção sociocultural: reconhecer e analisar questões sociais, culturais e ambientais; compreender e considerar a situação, a opinião e o sentimento do outro, agindo com empatia, flexibilidade e resiliência; participar ativamente da proposição, implementação e avaliação de soluções para problemas socioculturais e/ou ambientais.
- Empreendedorismo, autoconhecimento e projeto de vida: reconhecer e utilizar qualidades e fragilidades pessoais para superar desafios; utilizar estratégias de planejamento, organização e empreendedorismo para estabelecer e adaptar metas e realizar projetos pessoais e produtivos; refletir continuamente sobre seu desenvolvimento e seus objetivos presentes e futuros.`;

// Distribui as aulas de cada trimestre para o total pedido (aulas por semana × semanas), proporcionalmente.
function ajustarCargaAulas(plano: any, porTrimestre: number) {
  if (!porTrimestre) return plano;
  for (const t of plano.trimestres || []) {
    const cs = t.conteudos || [];
    const soma = cs.reduce((s: number, c: any) => s + (Number(c.aulas_estimadas) || 0), 0);
    if (!cs.length || !soma) continue;
    let acumulado = 0;
    cs.forEach((c: any, i: number) => {
      if (i === cs.length - 1) c.aulas_estimadas = Math.max(1, porTrimestre - acumulado);
      else {
        c.aulas_estimadas = Math.max(1, Math.round((Number(c.aulas_estimadas) || 0) * porTrimestre / soma));
        acumulado += c.aulas_estimadas;
      }
    });
  }
  return plano;
}

// Mantém só os códigos que existem no catálogo do professor (a IA não pode criar códigos).
function soCodigosValidos(plano: any, validos: Set<string>) {
  const filtrar = (lista: any) => (Array.isArray(lista) ? lista.filter((c) => validos.has(c)) : lista);
  for (const t of plano.trimestres || []) for (const c of t.conteudos || []) c.habilidades = filtrar(c.habilidades)?.slice(0, 3);
  if (plano.recomposicao) plano.recomposicao.habilidades = filtrar(plano.recomposicao.habilidades);
  if (plano.projetos_integradores) plano.projetos_integradores.habilidades_macroarea = filtrar(plano.projetos_integradores.habilidades_macroarea);
  if (plano.temas_transversais) plano.temas_transversais.habilidades_macroarea = filtrar(plano.temas_transversais.habilidades_macroarea);
  return plano;
}

async function gerarAnual(db: any, userId: string, planoId: string, habilidades: any[], materiais: any[], corpo: any) {
  const plano = await carregarAnual(db, planoId);
  const entrada = (plano.conteudo?.entrada?.conteudos || []).filter((c: any) => c.status !== 'removido');
  if (!entrada.length) throw new Error('Cadastre os conteúdos do ano antes de gerar.');

  let ideiaTexto = String(corpo.ideia_texto || '').trim();
  if (!ideiaTexto && corpo.ideia_arquivo_caminho && corpo.ideia_arquivo_nome) {
    try {
      ideiaTexto = await textoDeArquivo(db, corpo.ideia_arquivo_caminho, corpo.ideia_arquivo_nome);
    } catch (e) {
      // Não impede a geração caso falhe ao ler o anexo
      ideiaTexto = '';
    }
  }

  const projeto = String(corpo.projeto || '').trim();
  const reservar = String(corpo.reservar_para_projeto || 'decidir').trim();
  const redistribuir = String(corpo.redistribuir_conteudo || 'essenciais').trim();

  const extra = await materiaisParaPrompt(db, corpo, entrada.map((c: any) => `${c.titulo}${c.observacao ? ': ' + c.observacao : ''}`).join('\n'), plano.turmas?.curso_id);
  const prompt = `${REGRAS_BASE}

TAREFA: criar o PLANO ANUAL detalhado da disciplina, no formato do modelo de planejamento do colégio. Use o modelo como base obrigatória.

${MODELO_SECOES}

${COMPETENCIAS_EIXO}

${COMPETENCIAS_BNCC}

${EIXOS_CBTC}

HABILIDADES: para cada conteúdo, vincule no máximo 3 códigos do CATÁLOGO DE HABILIDADES, só os que tratam diretamente do objeto do conhecimento. Para ensino médio, use os códigos EM13CO e não use códigos EF (ensino fundamental). Use só códigos desse catálogo. Nas competências gerais e específicas, use os textos de eixo listados acima e o texto da BNCC quando houver.

CARGA DE AULAS: são ${plano.aulas_semana ?? 'não informado'} aulas por semana e cerca de 12 semanas por trimestre. A soma de aulas_estimadas de cada trimestre deve ficar perto de ${(plano.aulas_semana ?? 0) * 12}. Não deixe a soma muito distante desse valor. Distribua com coerência entre os trimestres.

PREENCHIMENTO: preencha TODAS as seções acima, inclusive recomposição, projetos integradores, temas transversais, avaliação e referências. Em referencias, liste os materiais usados com autor, título e ano quando forem conhecidos (se não souber o autor, use só o título). Não invente autores. Se o material não trouxer o conteúdo de uma seção, proponha algo coerente com o curso e a disciplina, e registre em observacoes quais seções foram propostas por você.

PROJETOS E AVALIAÇÃO DEFINIDOS PELO PROFESSOR
${corpo.projetos ? `- Projetos que o professor quer desenvolver com a turma: ${corpo.projetos}. Adapte os conteúdos, tópicos e atividades para que esses projetos façam parte do ano: use-os em projetos integradores e nos conteúdos em que se encaixam.` : '- Nenhum tipo de projeto foi indicado. Proponha projetos integradores coerentes com o curso e registre isso em observacoes.'}
${corpo.substituir_provas === 'todas' ? '- Substitua as provas pela aplicação do projeto: na avaliação de cada conteúdo, a prova escrita vira a entrega ou apresentação do projeto.' : corpo.substituir_provas === 'algumas' ? '- Substitua a prova por aplicação do projeto em algumas avaliações. Diga em avaliacao de cada conteúdo quais são essas avaliações.' : '- Mantenha as provas escritas. O projeto é complementar à avaliação.'}

PROJETO/DINÂMICA IDEA PELO PROFESSOR (PRIORITÁRIO)
${projeto ? `- Título/ideia: ${projeto}` : '- Nenhum projeto/dinâmica foi descrito pelo professor.'}
${ideiaTexto ? `- Detalhes/rascunho anexado ou colado pelo professor:\n${ideiaTexto}` : '- Sem anexo/rascunho adicional.'}
- Reservar aulas para aplicação/orientação do projeto: ${reservar === 'sim' ? 'SIM. Reserve um bloco de aulas para aplicação, desenvolvimento, testes e apresentação do projeto.' : reservar === 'nao' ? 'NÃO. Não reserve aulas exclusivamente para o projeto, mas aproveite momentos de aplicação quando couber.' : 'DECIDIR COM INTELIGÊNCIA. Analise a carga horária, pré-requisitos e viabilidade para a turma.'}
- Abrir mão de aulas de conteúdos para dar espaço ao projeto: ${redistribuir === 'todos' ? 'SIM, posso redistribuir. Se necessário, reduza aulas de conteúdos secundários para abrir espaço ao projeto/aplicação.' : redistribuir === 'nenhum' ? 'NÃO. Mantenha a carga horária dos conteúdos exatamente coerente com o que foi planejado, sem reduzir.' : 'APENAS conteúdos menos essenciais. NÃO reduza conteúdos que sejam pré-requisito direto para o projeto ou estruturantes da disciplina. Diminua com critério, priorizando conteúdos pontuais.'}

ORIENTAÇÕES PARA PROJETO/APLICAÇÃO
- Se houver projeto/dinâmica e fizer sentido, CRIE um conteúdo/ação prática com o título claro no trimestre mais adequado (pode ser ao longo de trimestres). Chame de algo como "Projeto/Aplicação prática" ou mantenha coerente com o tema.
- Gere um bloco detalhado: objetivos, etapas/passos, divisão por aulas, materiais, forma de acompanhamento/orientação, avaliação (entrega/apresentação/autoavaliação).
- Redistribua "aulas_estimadas" entre os conteúdos: ao reservar aulas para o projeto, reduza proporcionalmente as aulas dos conteúdos escolhidos com critério. A soma por trimestre deve continuar próxima de ${plano.aulas_semana ?? 0} * 12.
- Não crie um projeto genérico solto. Relacione com pelo menos alguns conteúdos do ano e com as habilidades do catálogo quando aplicável.
- Em "observacoes", explique OBJETIVAMENTE: quais conteúdos tiveram carga reduzida (se houver), quantas aulas foram reservadas para o projeto/aplicação e o motivo da redistribuição.

CONTEXTO
- Colégio: ${plano.turmas?.colegios?.nome}
- Curso: ${plano.turmas?.cursos?.nome || plano.turmas?.curso || 'não informado'} · Série: ${plano.turmas?.serie}º ano · Turma: ${plano.turmas?.nome} · Ano letivo: ${plano.ano}
- Particularidades da turma: ${plano.turmas?.observacoes || 'nenhuma informada'}
- Disciplina: ${plano.disciplinas?.nome}
- Alunos: ${plano.turmas?.qtd_alunos ?? 'não informado'} (somente para cabeçalho)
- Aulas por semana: ${plano.aulas_semana ?? 'não informado'}
- Materiais-base escolhidos para este plano (só estes podem ser citados): ${materiais.filter((m: any) => m.categoria === 'material_base' && (corpo.fonte_ids ?? []).includes(m.id)).map((m: any) => m.nome).join('; ') || 'nenhum'}
- Modelos do colégio cadastrados: ${materiais.filter((m: any) => m.categoria === 'modelo').map((m: any) => m.nome).join('; ') || 'nenhum'}

CONTEÚDOS DO ANO (use todos, na ordem e no trimestre indicados)
${entrada.map((c: any) => `- [${c.trimestre}º trimestre] ${c.titulo}${c.observacao ? ` (obs.: ${c.observacao})` : ''} (situação: ${c.status})`).join('\n')}

${extra}CATÁLOGO DE HABILIDADES (código: descrição)
${listaHabilidades(habilidades)}

FORMATO DO JSON (todas as chaves; use lista vazia quando não houver o que colocar):
{
  "identificacao": { "serie_ano": "...", "componente": "...", "aulas_semanais": 3, "turmas": "...", "ano_letivo": 2026 },
  "competencias_gerais": ["competência do componente, com o texto de eixo quando se aplicar"],
  "competencias_especificas": ["competência específica da disciplina"],
  "trimestres": [
    {
      "numero": 1,
      "titulo": "...",
      "objetivos": ["..."],
      "conteudos": [
        {
          "titulo": "...",
          "unidade_tematica": "...",
          "objeto_conhecimento": ["objeto do conhecimento"],
          "descricao": "...",
          "topicos": ["tópicos detalhados, prontos para o professor adaptar"],
          "habilidades": ["código do catálogo"],
          "metodologia": "metodologia/estratégia da aula",
          "materiais": ["material de apoio ou referência"],
          "avaliacao": "forma de avaliação sugerida",
          "aulas_estimadas": 4
        }
      ]
    }
  ],
  "recomposicao": { "unidade_tematica": "...", "objeto_conhecimento": ["..."], "habilidades": ["código do catálogo"], "metodologia": "..." },
  "projetos_integradores": { "temas": "...", "tema_especifico": "...", "habilidades_macroarea": ["código do catálogo"], "metodologia": "...", "atividades": ["..."] },
  "temas_transversais": { "competencias_gerais": ["..."], "competencias_especificas": ["..."], "habilidades_macroarea": ["código do catálogo"], "metodologia": "..." },
  "avaliacao": { "instrumentos": ["..."], "criterios": ["..."] },
  "referencias": ["bibliografia usada ao longo do ano"],
  "observacoes": "resumo de como o ano foi distribuído e pontos de atenção"
}`;

  const saida = ajustarCargaAulas(soCodigosValidos(await gemini(prompt), new Set(habilidades.map((h: any) => h.codigo))), (plano.aulas_semana ?? 0) * 12);
  const planoGerado = { ...saida, professor: corpo.professor, cabecalho: {
    colegio: plano.turmas?.colegios?.nome, turma: plano.turmas?.nome, serie: plano.turmas?.serie,
    curso: plano.turmas?.cursos?.nome || plano.turmas?.curso, alunos: plano.turmas?.qtd_alunos, ano: plano.ano,
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
