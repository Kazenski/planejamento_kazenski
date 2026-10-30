-- Materiais ligados a um curso técnico. Um material "orientador" (ex.: matriz de conteúdos por disciplina)
-- entra automaticamente na geração dos planos das turmas daquele curso.
alter table public.fontes_material
  add column if not exists curso_id uuid references public.cursos(id) on delete cascade,
  add column if not exists orientador boolean not null default false;

create index if not exists idx_fontes_curso on public.fontes_material (curso_id);
