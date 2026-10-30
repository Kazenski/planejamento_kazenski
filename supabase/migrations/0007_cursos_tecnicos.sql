-- Cursos técnicos. Uma disciplina pertence a um curso. Uma turma também.

create table if not exists public.cursos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (user_id, nome)
);

alter table public.cursos enable row level security;
revoke all on public.cursos from anon;
drop policy if exists "dono_cursos" on public.cursos;
create policy "dono_cursos" on public.cursos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.disciplinas
  add column if not exists curso_id uuid references public.cursos(id) on delete set null;

alter table public.turmas
  add column if not exists curso_id uuid references public.cursos(id) on delete set null;

-- Aproveita os cursos que já estavam escritos nas turmas.
insert into public.cursos (user_id, nome)
select distinct user_id, curso from public.turmas where curso is not null and curso <> ''
on conflict (user_id, nome) do nothing;

update public.turmas t
set curso_id = c.id
from public.cursos c
where c.user_id = t.user_id and c.nome = t.curso and t.curso_id is null;

create index if not exists idx_disciplinas_curso on public.disciplinas (curso_id);
create index if not exists idx_turmas_curso on public.turmas (curso_id);
