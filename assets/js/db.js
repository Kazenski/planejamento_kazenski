import { supabase } from './supabase.js';

// Leitura de tabela. `ajuste` recebe o builder do Supabase para filtros extras.
export async function listar(tabela, { select = '*', ordem = 'criado_em', asc = true, ajuste } = {}) {
  let consulta = supabase.from(tabela).select(select);
  if (ajuste) consulta = ajuste(consulta);
  if (ordem) consulta = consulta.order(ordem, { ascending: asc });
  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

export async function inserir(tabela, valores) {
  const { data, error } = await supabase.from(tabela).insert(valores).select();
  if (error) throw error;
  return data;
}

export async function inserirVarios(tabela, lista) {
  if (!lista.length) return [];
  const { data, error } = await supabase.from(tabela).insert(lista).select();
  if (error) throw error;
  return data;
}

export async function atualizar(tabela, id, valores) {
  const { data, error } = await supabase.from(tabela).update(valores).eq('id', id).select();
  if (error) throw error;
  return data;
}

export async function excluir(tabela, id) {
  const { error } = await supabase.from(tabela).delete().eq('id', id);
  if (error) throw error;
}

export async function getConfig(chave, padrao = null) {
  const { data, error } = await supabase.from('configuracoes').select('valor').eq('chave', chave).maybeSingle();
  if (error) throw error;
  return data ? data.valor : padrao;
}

export async function setConfig(chave, valor) {
  const { error } = await supabase.from('configuracoes').upsert(
    { chave, valor, atualizado_em: new Date().toISOString() },
    { onConflict: 'user_id,chave' }
  );
  if (error) throw error;
}

export function msgErro(err) {
  if (!err) return 'Erro desconhecido.';
  if (err.code === '23505') return 'Já existe um registro igual. Verifique os campos únicos.';
  if (err.code === '23503') return 'Este registro está em uso por outro cadastro.';
  if (err.code === '23514') return 'Algum valor está fora do permitido (ex.: série de 1 a 3).';
  return err.message || String(err);
}
