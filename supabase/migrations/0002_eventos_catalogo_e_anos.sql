-- Catálogo de eventos (o calendário escolhe a partir daqui, sem texto livre)
-- e ano letivo em colégios e disciplinas.

alter table public.colegios
  add column if not exists ano smallint not null default (extract(year from current_date))::smallint;

alter table public.disciplinas
  add column if not exists ano smallint not null default (extract(year from current_date))::smallint;

create table if not exists public.eventos_catalogo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in (
    'feriado_nacional', 'feriado_estadual', 'feriado_municipal',
    'ponto_facultativo', 'recesso', 'evento_colegio', 'acao_pedagogica'
  )),
  dia_letivo boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (user_id, nome)
);

alter table public.calendario_eventos
  add column if not exists catalogo_id uuid references public.eventos_catalogo(id) on delete set null;

alter table public.eventos_catalogo enable row level security;
revoke all on public.eventos_catalogo from anon;
drop policy if exists "dono_eventos_catalogo" on public.eventos_catalogo;
create policy "dono_eventos_catalogo" on public.eventos_catalogo
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_calendario_catalogo on public.calendario_eventos (catalogo_id);
create index if not exists idx_colegios_ano on public.colegios (user_id, ano);
create index if not exists idx_disciplinas_ano on public.disciplinas (user_id, ano);
