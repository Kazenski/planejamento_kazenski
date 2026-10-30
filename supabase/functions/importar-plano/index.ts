// Importa um plano anual anterior (DOCX ou PDF) e converte para o plano anual do sistema, com IA (Gemini).
// O arquivo fica no Storage (bucket materiais, pasta do próprio usuário). A chave GEMINI_API_KEY fica em segredo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';
import { getDocumentProxy, extractText } from 'npm:unpdf@1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MODELO = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const LIMITE_TEXTO = 80000;

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function decodificar(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function textoDocx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const arq = zip.file('word/document.xml');
  if (!arq) throw new Error('Arquivo DOCX inválido.');
  const xml = await arq.async('string');
  const semTags = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, '');
  return decodificar(semTags);
}

async function textoPdf(buf: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text);
}

async function gemini(prompt: string): Promise<any> {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) throw new Error('A chave da IA não está configurada no Supabase (GEMINI_API_KEY).');
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 16384 }
    })
  });
  if (!resp.ok) throw new Error(`A IA respondeu com erro ${resp.status}. Tente novamente em instantes.`);
  const dados = await resp.json();
  const texto = dados.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error('A IA devolveu um formato inválido. Tente importar novamente.');
  }
}

function montarPrompt(texto: string, ctx: { colegio: string; turma: string; disciplina: string; ano: number }) {
  return `Você converte um PLANO DE ENSINO ANUAL escrito pelo professor para o formato de plano anual do sistema.

REGRAS
- Use SOMENTE o que está no texto do plano. Não invente conteúdos, códigos de habilidade, competências ou bibliografia.
- Se uma seção não existir no texto, deixe a lista vazia ou o texto em branco.
- Mantenha os códigos de habilidade e de competência exatamente como aparecem no texto.
- Em cada conteúdo, separe a unidade temática, os objetos do conhecimento, as habilidades e a metodologia, quando o texto trouxer essas informações.
- aulas_estimadas: use a quantidade informada no texto. Se não houver, estime pela carga semanal dividida pelos trimestres (cerca de 12 semanas por trimestre).
- Escreva em português do Brasil e responda SOMENTE com JSON válido.

CONTEXTO
- Colégio: ${ctx.colegio}
- Turma: ${ctx.turma}
- Disciplina: ${ctx.disciplina}
- Ano letivo: ${ctx.ano}

FORMATO DO JSON (todas as chaves):
{
  "identificacao": { "serie_ano": "...", "componente": "...", "aulas_semanais": 3, "turmas": "...", "ano_letivo": ${ctx.ano} },
  "competencias_gerais": ["..."],
  "competencias_especificas": ["..."],
  "trimestres": [
    {
      "numero": 1,
      "titulo": "...",
      "objetivos": ["..."],
      "conteudos": [
        {
          "titulo": "...",
          "unidade_tematica": "...",
          "objeto_conhecimento": ["..."],
          "descricao": "...",
          "topicos": ["..."],
          "habilidades": ["..."],
          "metodologia": "...",
          "materiais": ["..."],
          "avaliacao": "...",
          "aulas_estimadas": 4
        }
      ]
    }
  ],
  "recomposicao": { "unidade_tematica": "...", "objeto_conhecimento": ["..."], "habilidades": ["..."], "metodologia": "..." },
  "projetos_integradores": { "temas": "...", "tema_especifico": "...", "habilidades_macroarea": ["..."], "metodologia": "...", "atividades": ["..."] },
  "temas_transversais": { "competencias_gerais": ["..."], "competencias_especificas": ["..."], "habilidades_macroarea": ["..."], "metodologia": "..." },
  "avaliacao": { "instrumentos": ["..."], "criterios": ["..."] },
  "referencias": ["bibliografia citada no texto"],
  "observacoes": "pontos do plano anterior que merecem revisão no novo ano"
}

TEXTO DO PLANO ANTERIOR:
${texto}`;
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

    const { caminho, nome, turma_id, disciplina_id, ano } = await req.json();
    if (!caminho || !nome || !turma_id || !disciplina_id || !ano) return json({ erro: 'Informe turma, disciplina, ano e arquivo.' }, 400);

    const ext = String(nome).toLowerCase().split('.').pop();
    if (ext !== 'docx' && ext !== 'pdf') return json({ erro: 'Formato não suportado. Envie DOCX ou PDF.' }, 400);

    const { data: arquivo, error: erroArq } = await db.storage.from('materiais').download(caminho);
    if (erroArq || !arquivo) return json({ erro: 'Não foi possível ler o arquivo enviado.' }, 400);

    const buf = await arquivo.arrayBuffer();
    let texto = ext === 'docx' ? await textoDocx(buf) : await textoPdf(buf);
    texto = texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, LIMITE_TEXTO);
    if (texto.length < 200) return json({ erro: 'Não encontrei texto suficiente no arquivo.' }, 400);

    const { data: turma } = await db.from('turmas')
      .select('nome, serie, qtd_alunos, colegios(nome), cursos(nome)').eq('id', turma_id).single();
    const { data: disc } = await db.from('disciplinas').select('nome').eq('id', disciplina_id).single();
    if (!turma || !disc) return json({ erro: 'Turma ou disciplina não encontrada.' }, 404);

    const saida = await gemini(montarPrompt(texto, {
      colegio: turma.colegios?.nome || 'não informado',
      turma: turma.nome,
      disciplina: disc.nome,
      ano
    }));

    const { count } = await db.from('planos_anuais').select('id', { count: 'exact', head: true })
      .eq('turma_id', turma_id).eq('disciplina_id', disciplina_id).eq('ano', ano);

    const entrada = (saida.trimestres || []).flatMap((t: any) =>
      (t.conteudos || []).map((c: any) => ({ titulo: c.titulo, trimestre: t.numero, status: 'novo' })));
    const plano = { ...saida, cabecalho: {
      colegio: turma.colegios?.nome, turma: turma.nome, serie: turma.serie, curso: turma.cursos?.nome,
      alunos: turma.qtd_alunos, ano, disciplina: disc.nome
    } };

    const { data: novo, error: erroIns } = await db.from('planos_anuais').insert({
      turma_id,
      disciplina_id,
      ano,
      versao: (count || 0) + 1,
      status: 'gerado',
      conteudo: { entrada: { conteudos: entrada }, plano },
      atualizado_em: new Date().toISOString()
    }).select('id').single();
    if (erroIns) return json({ erro: erroIns.message }, 500);

    return json({ ok: true, plano_id: novo.id });
  } catch (err) {
    return json({ erro: (err as Error).message || 'Erro inesperado.' }, 500);
  }
});
