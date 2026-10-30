-- Cursos oferecidos por cada colégio, e o horário semanal das aulas do professor.

create table if not exists public.colegio_cursos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  colegio_id uuid not null references public.colegios(id) on delete cascade,
  curso_id uuid not null references public.cursos(id) on delete cascade,
  primary key (colegio_id, curso_id)
);

-- Uma linha por aula semanal de um vínculo turma x disciplina que o professor leciona.
-- dia_semana: 1 = segunda ... 5 = sexta.
-- periodo: grade de 7 linhas: 1, 2 e 3 antes do recreio; 4 é o recreio (não recebe aula); 5, 6 e 7 depois.
-- Sem dia e período = aula ainda não posicionada no horário.
create table if not exists public.horario_aulas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  turma_disciplina_id uuid not null references public.turma_disciplinas(id) on delete cascade,
  ordem smallint not null check (ordem > 0),
  dia_semana smallint check (dia_semana between 1 and 5),
  periodo smallint check (periodo in (1, 2, 3, 5, 6, 7)),
  unique (turma_disciplina_id, ordem),
  check ((dia_semana is null) = (periodo is null))
);

alter table public.colegio_cursos enable row level security;
alter table public.horario_aulas enable row level security;
revoke all on public.colegio_cursos from anon;
revoke all on public.horario_aulas from anon;

drop policy if exists "dono_colegio_cursos" on public.colegio_cursos;
create policy "dono_colegio_cursos" on public.colegio_cursos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "dono_horario_aulas" on public.horario_aulas;
create policy "dono_horario_aulas" on public.horario_aulas
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_horario_td on public.horario_aulas (turma_disciplina_id);
