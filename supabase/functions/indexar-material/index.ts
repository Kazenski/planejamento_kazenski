// Indexa um material-base: extrai o texto, divide em trechos, gera embeddings e sugere a classificação.
// Processa em blocos de páginas (pagina_inicio), para caber no tempo da função. O site chama em sequência.
// A chave GEMINI_API_KEY fica em segredo. As gravações usam o token do próprio usuário (RLS).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getDocumentProxy } from 'npm:unpdf@1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MODELO_EMBEDDING = 'models/gemini-embedding-001';
const DIMENSOES = 768;
const MODELO_IA = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const TAMANHO_TRECHO = 1400;
const SOBREPOSICAO = 200;
const PAGINAS_POR_CHAMADA = 40;

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function chaveGemini(): string {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) throw new Error('A chave da IA não está configurada no Supabase (GEMINI_API_KEY).');
  return chave;
}

function dividir(texto: string): string[] {
  // Caracteres de controle (ex.: \u0000 de PDFs mal formados) não são aceitos pelo Postgres.
  const limpo = texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  const t = limpo.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    let fim = Math.min(i + TAMANHO_TRECHO, t.length);
    if (fim < t.length) {
      const corte = t.lastIndexOf(' ', fim);
      if (corte > i + 500) fim = corte;
    }
    const trecho = t.slice(i, fim).trim();
    if (trecho) out.push(trecho);
    if (fim >= t.length) break;
    i = Math.max(fim - SOBREPOSICAO, i + 1);
  }
  return out;
}

function normalizar(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// Com 768 dimensões, o gemini-embedding-001 exige normalização manual.
async function embeddings(textos: string[], tarefa: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < textos.length; i += 100) {
    const lote = textos.slice(i, i + 100);
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chaveGemini() },
      body: JSON.stringify({
        requests: lote.map((texto) => ({
          model: MODELO_EMBEDDING,
          content: { parts: [{ text: texto }] },
          taskType: tarefa,
          outputDimensionality: DIMENSOES
        }))
      })
    });
    if (!resp.ok) throw new Error(`O serviço de embeddings respondeu com erro ${resp.status}.`);
    const dados = await resp.json();
    for (const e of dados.embeddings) out.push(normalizar(e.values));
  }
  return out;
}

async function classificar(nome: string, amostra: string, disciplinas: string[]): Promise<any> {
  const prompt = `Você classifica materiais de referência para planejamento de aulas do ensino técnico (ensino médio), no Brasil.
Responda SOMENTE com JSON válido, em português do Brasil.

Arquivo: ${nome}
Disciplinas cadastradas pelo professor (use só estas quando houver correspondência): ${disciplinas.join('; ') || 'nenhuma'}

Trecho inicial do material:
"""
${amostra}
"""

FORMATO:
{
  "tipo_material": "livro | curriculo_oficial | apostila | artigo | slides | outro",
  "area_geral": "área ampla, ex.: Computação, Redes, Desenvolvimento",
  "area_especifica": "tema específico, ex.: Programação em Python, Banco de dados",
  "disciplinas": ["disciplinas cadastradas que este material atende"],
  "resumo": "2 ou 3 frases sobre o conteúdo"
}`;
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IA}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chaveGemini() },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  if (!resp.ok) throw new Error(`A IA respondeu com erro ${resp.status} ao classificar.`);
  const dados = await resp.json();
  return JSON.parse(dados.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '{}');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }
  });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ erro: 'Sessão expirada. Entre novamente.' }, 401);

  const { fonte_id, pagina_inicio = 1 } = await req.json();
  const { data: fonte, error: erroFonte } = await db.from('fontes_material').select('*').eq('id', fonte_id).single();
  if (erroFonte || !fonte) return json({ erro: 'Material não encontrado.' }, 404);

  const ehPdf = fonte.mime_type === 'application/pdf' || /\.pdf$/i.test(fonte.nome);
  const ehTexto = fonte.mime_type?.startsWith('text/') || /\.(txt|md)$/i.test(fonte.nome);
  if (!ehPdf && !ehTexto) {
    return json({ erro: 'Este formato não é indexado. Use PDF, TXT ou MD.' }, 400);
  }

  try {
    const comeco = Number(pagina_inicio) === 1;
    await db.from('fontes_material').update({
      status: 'processando',
      erro_indexacao: null,
      ...(comeco ? { paginas_indexadas: 0 } : {})
    }).eq('id', fonte_id);

    const [bucket, ...resto] = fonte.storage_path.split('/');
    const caminho = resto.join('/');
    const { data: arquivo, error: erroDown } = await db.storage.from(bucket).download(caminho);
    if (erroDown || !arquivo) throw new Error('Não foi possível ler o arquivo no armazenamento.');
    const bytes = new Uint8Array(await arquivo.arrayBuffer());

    let paginasTexto: string[] = [];
    let total: number;
    const inicio = Math.max(1, Number(pagina_inicio));
    let fim: number;
    if (ehPdf) {
      const pdf = await getDocumentProxy(bytes);
      total = pdf.numPages;
      fim = Math.min(total, inicio + PAGINAS_POR_CHAMADA - 1);
      // Só as páginas do bloco, para não estourar a memória da função.
      for (let p = inicio; p <= fim; p++) {
        const pagina = await pdf.getPage(p);
        const conteudo = await pagina.getTextContent();
        paginasTexto.push(conteudo.items.map((item: any) => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
      }
    } else {
      paginasTexto = [new TextDecoder().decode(bytes)];
      total = 1;
      fim = 1;
    }

    if (inicio === 1) {
      await db.from('material_trechos').delete().eq('fonte_id', fonte_id);
    }

    // ordem = página * 1000 + posição no bloco: única e crescente, sem contar linhas no banco.
    const trechos: { ordem: number; pagina: number; conteudo: string }[] = [];
    for (let p = inicio; p <= fim; p++) {
      const pedacos = dividir(paginasTexto[ ehPdf ? p - inicio : 0 ] ?? '');
      pedacos.forEach((conteudo, k) => trechos.push({ ordem: p * 1000 + k, pagina: ehPdf ? p : 0, conteudo }));
    }

    const vetores = await embeddings(trechos.map((t) => t.conteudo), 'RETRIEVAL_DOCUMENT');
    const linhas = trechos.map((t, i) => ({
      fonte_id,
      user_id: user.id,
      ordem: t.ordem,
      pagina: t.pagina || null,
      conteudo: t.conteudo,
      embedding: JSON.stringify(vetores[i])
    }));
    for (let i = 0; i < linhas.length; i += 200) {
      const { error } = await db.from('material_trechos').insert(linhas.slice(i, i + 200));
      if (error) throw new Error(`Erro ao gravar trechos: ${error.message}`);
    }

    // Classificação automática, feita uma vez (o professor confirma ou ajusta depois).
    // Falha na sugestão não impede a indexação: o professor classifica manualmente.
    if (inicio === 1 && !fonte.sugestao) {
      try {
      const amostra = paginasTexto.slice(0, 4).join('\n').slice(0, 12000);
      const { data: discs } = await db.from('disciplinas').select('nome');
      const sugestao = await classificar(fonte.nome, amostra, (discs ?? []).map((d: any) => d.nome));
      const atualizar: Record<string, unknown> = { sugestao };
      if (!fonte.tipo_material && sugestao.tipo_material) atualizar.tipo_material = sugestao.tipo_material;
      if (!fonte.area_geral && sugestao.area_geral) atualizar.area_geral = sugestao.area_geral;
      if (!fonte.area_especifica && sugestao.area_especifica) atualizar.area_especifica = sugestao.area_especifica;
      if (!fonte.resumo && sugestao.resumo) atualizar.resumo = sugestao.resumo;
      if ((!fonte.disciplinas || fonte.disciplinas.length === 0) && Array.isArray(sugestao.disciplinas)) atualizar.disciplinas = sugestao.disciplinas;
      await db.from('fontes_material').update(atualizar).eq('id', fonte_id);
      } catch (erroSugestao) {
        console.error('Classificação automática falhou:', (erroSugestao as Error).message);
      }
    }

    const concluido = fim >= total;
    await db.from('fontes_material').update({
      status: concluido ? 'indexado' : 'processando',
      paginas: total,
      paginas_indexadas: fim
    }).eq('id', fonte_id);

    return json({
      ok: true,
      total_paginas: total,
      processadas_ate: fim,
      proxima_pagina: concluido ? null : fim + 1,
      trechos: linhas.length
    });
  } catch (err) {
    const mensagem = (err as Error).message || 'Erro inesperado.';
    await db.from('fontes_material').update({ status: 'erro', erro_indexacao: mensagem }).eq('id', fonte_id);
    return json({ erro: mensagem }, 500);
  }
});
