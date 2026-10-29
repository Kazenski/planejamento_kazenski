-- Indexação dos materiais-base: classificação, trechos e busca semântica (pgvector).
-- Os trechos são gerados só quando o professor pede (indexar) e usados só nos materiais escolhidos na geração.

create extension if not exists vector with schema extensions;

alter table public.fontes_material
  add column if not exists tipo_material text,
  add column if not exists area_geral text,
  add column if not exists area_especifica text,
  add column if not exists disciplinas text[] not null default '{}',
  add column if not exists paginas integer,
  add column if not exists resumo text,
  add column if not exists sugestao jsonb,
  add column if not exists erro_indexacao text;

alter table public.fontes_material drop constraint if exists fontes_material_status_check;
alter table public.fontes_material
  add constraint fontes_material_status_check check (status in ('pendente', 'processando', 'indexado', 'erro'));

alter table public.fontes_material drop constraint if exists fontes_material_tipo_material_check;
alter table public.fontes_material
  add constraint fontes_material_tipo_material_check check (
    tipo_material is null or tipo_material in ('livro', 'curriculo_oficial', 'apostila', 'artigo', 'slides', 'outro')
  );

create table if not exists public.material_trechos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fonte_id uuid not null references public.fontes_material(id) on delete cascade,
  ordem integer not null,
  pagina integer,
  conteudo text not null,
  embedding extensions.vector(768) not null,
  unique (fonte_id, ordem)
);

alter table public.material_trechos enable row level security;
revoke all on public.material_trechos from anon;
drop policy if exists "dono_material_trechos" on public.material_trechos;
create policy "dono_material_trechos" on public.material_trechos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_material_trechos_fonte on public.material_trechos (fonte_id);
create index if not exists idx_material_trechos_embedding on public.material_trechos
  using hnsw (embedding extensions.vector_cosine_ops);

-- Busca os trechos mais próximos da consulta, só nos materiais informados e só do próprio usuário.
create or replace function public.buscar_trechos(consulta extensions.vector(768), fontes uuid[], limite integer default 30)
returns table (fonte_id uuid, pagina integer, conteudo text, similaridade double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select t.fonte_id, t.pagina, t.conteudo, 1 - (t.embedding <=> consulta)
  from public.material_trechos t
  where t.fonte_id = any(fontes) and t.user_id = auth.uid()
  order by t.embedding <=> consulta
  limit limite;
$$;
