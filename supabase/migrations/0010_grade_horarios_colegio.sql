-- Grade de horários de cada colégio. Cada linha é um período (ordem 1, 2, 3...).
-- tipo = 'aula' ou 'intervalo' (recreio, almoço etc.: não recebe aula).
-- Colégio sem grade cadastrada usa a grade padrão do sistema (6 aulas + recreio após a 3ª).
create table if not exists public.colegio_horarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  colegio_id uuid not null references public.colegios(id) on delete cascade,
  ordem smallint not null check (ordem > 0),
  tipo text not null default 'aula' check (tipo in ('aula', 'intervalo')),
  rotulo text,
  inicio time,
  fim time,
  unique (colegio_id, ordem)
);

alter table public.colegio_horarios enable row level security;
revoke all on public.colegio_horarios from anon;
drop policy if exists "dono_colegio_horarios" on public.colegio_horarios;
create policy "dono_colegio_horarios" on public.colegio_horarios
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- O período agora é a ordem na grade do colégio (até 12).
alter table public.horario_aulas drop constraint if exists horario_aulas_periodo_check;
alter table public.horario_aulas add constraint horario_aulas_periodo_check
  check (periodo is null or periodo between 1 and 12);
