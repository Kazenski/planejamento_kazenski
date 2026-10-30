-- Horário próprio de cada aula (opcional). Se vazio, vale o horário do período na grade do colégio.
alter table public.horario_aulas
  add column if not exists inicio time,
  add column if not exists fim time;
