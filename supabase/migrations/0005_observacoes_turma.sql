-- Particularidades de cada turma, consideradas pela IA na geração dos planos.
alter table public.turmas
  add column if not exists observacoes text;
