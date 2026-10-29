-- Progresso da indexação: permite retomar de onde parou (ex.: se a aba for fechada no meio).
alter table public.fontes_material
  add column if not exists paginas_indexadas integer not null default 0;
