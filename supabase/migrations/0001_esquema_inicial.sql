-- Planejamento Kazenski: esquema inicial
-- Todas as tabelas são do usuário logado (user_id = auth.uid()), com RLS ativo.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Configurações gerais (ex.: dias letivos do ano)
-- ---------------------------------------------------------------
create table if not exists public.configuracoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chave text not null,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  unique (user_id, chave)
);

-- ---------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------
create table if not exists public.colegios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  direcao text,
  coordenacao text,
  supervisao text,
  emails_copia text[] not null default '{}',
  emails_material text[] not null default '{}',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.disciplinas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.turmas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  colegio_id uuid not null references public.colegios(id) on delete cascade,
  ano smallint not null check (ano between 2000 and 2100),
  nome text not null,
  serie smallint not null check (serie between 1 and 3),
  curso text not null default 'Técnico em Informática',
  qtd_alunos integer check (qtd_alunos is null or qtd_alunos >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.turma_disciplinas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas(id) on delete cascade,
  aulas_semana smallint not null check (aulas_semana > 0),
  unique (turma_id, disciplina_id)
);

-- ---------------------------------------------------------------
-- Calendário: feriados, recessos, eventos e ações do colégio
-- Dia útil sem registro = dia letivo. Feriado ou evento com dia_letivo = false = sem aula.
-- ---------------------------------------------------------------
create table if not exists public.calendario_eventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  nome text not null,
  tipo text not null check (tipo in (
    'feriado_nacional', 'feriado_estadual', 'feriado_municipal',
    'ponto_facultativo', 'recesso', 'evento_colegio', 'acao_pedagogica'
  )),
  dia_letivo boolean not null default false,
  todos_colegios boolean not null default true,
  origem text not null default 'manual' check (origem in ('manual', 'brasilapi')),
  criado_em timestamptz not null default now()
);

create table if not exists public.evento_colegios (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  evento_id uuid not null references public.calendario_eventos(id) on delete cascade,
  colegio_id uuid not null references public.colegios(id) on delete cascade,
  primary key (evento_id, colegio_id)
);

-- ---------------------------------------------------------------
-- Habilidades (catálogo a partir dos anexos)
-- ---------------------------------------------------------------
create table if not exists public.habilidades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  codigo text not null,
  descricao text,
  documento_origem text,
  eixo text,
  unique (user_id, codigo)
);

-- ---------------------------------------------------------------
-- Planejamentos
-- ---------------------------------------------------------------
create table if not exists public.planos_anuais (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  disciplina_id uuid not null references public.disciplinas(id) on delete cascade,
  ano smallint not null,
  versao integer not null default 1,
  origem_id uuid references public.planos_anuais(id) on delete set null,
  conteudo jsonb not null default '{}'::jsonb,
  status text not null default 'rascunho' check (status in ('rascunho', 'gerado', 'aprovado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (turma_id, disciplina_id, versao)
);

create table if not exists public.planos_anuais_habilidades (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plano_anual_id uuid not null references public.planos_anuais(id) on delete cascade,
  habilidade_id uuid not null references public.habilidades(id) on delete cascade,
  primary key (plano_anual_id, habilidade_id)
);

create table if not exists public.planos_mensais (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plano_anual_id uuid not null references public.planos_anuais(id) on delete cascade,
  mes smallint not null check (mes between 2 and 12),
  conteudo jsonb not null default '{}'::jsonb,
  ajustes jsonb not null default '{}'::jsonb,
  status text not null default 'rascunho' check (status in ('rascunho', 'gerado', 'desatualizado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (plano_anual_id, mes)
);

create table if not exists public.planos_diarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plano_mensal_id uuid not null references public.planos_mensais(id) on delete cascade,
  data date not null,
  aula_numero smallint not null default 1 check (aula_numero > 0),
  conteudo jsonb not null default '{}'::jsonb,
  pratica_docente text,
  status text not null default 'rascunho' check (status in ('rascunho', 'gerado', 'desatualizado')),
  criado_em timestamptz not null default now(),
  unique (plano_mensal_id, data, aula_numero)
);

-- ---------------------------------------------------------------
-- Materiais-base (Drive ou Storage) e log da IA
-- ---------------------------------------------------------------
create table if not exists public.fontes_material (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  origem text not null default 'drive' check (origem in ('drive', 'storage')),
  drive_file_id text,
  mime_type text,
  categoria text not null default 'material_base' check (categoria in ('material_base', 'modelo')),
  status text not null default 'pendente' check (status in ('pendente', 'indexado', 'erro')),
  criado_em timestamptz not null default now(),
  unique (user_id, drive_file_id)
);

create table if not exists public.geracoes_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('anual', 'mensal', 'diario')),
  entrada jsonb not null default '{}'::jsonb,
  saida jsonb,
  modelo text,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Segurança: RLS por usuário, sem acesso para anon
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'configuracoes', 'colegios', 'disciplinas', 'turmas', 'turma_disciplinas',
    'calendario_eventos', 'evento_colegios', 'habilidades',
    'planos_anuais', 'planos_anuais_habilidades', 'planos_mensais', 'planos_diarios',
    'fontes_material', 'geracoes_ia'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "dono_%s" on public.%I', t, t);
    execute format(
      'create policy "dono_%s" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t, t
    );
  end loop;
end $$;

-- Índices para as consultas mais comuns
create index if not exists idx_turmas_colegio_ano on public.turmas (colegio_id, ano);
create index if not exists idx_calendario_data on public.calendario_eventos (user_id, data);
create index if not exists idx_planos_anuais_turma on public.planos_anuais (turma_id, disciplina_id);
create index if not exists idx_planos_mensais_anual on public.planos_mensais (plano_anual_id);
create index if not exists idx_planos_diarios_mensal on public.planos_diarios (plano_mensal_id);
