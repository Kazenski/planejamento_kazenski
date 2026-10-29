-- Materiais e modelos no Supabase Storage (sem Drive).
-- Cada arquivo fica em: <user_id>/<categoria>/<nome-seguro>
-- Buckets privados: o acesso é só do dono, pelo login Google.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('materiais', 'materiais', false, 209715200),
  ('modelos', 'modelos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "dono_storage_select" on storage.objects;
drop policy if exists "dono_storage_insert" on storage.objects;
drop policy if exists "dono_storage_update" on storage.objects;
drop policy if exists "dono_storage_delete" on storage.objects;

create policy "dono_storage_select" on storage.objects for select to authenticated
  using (bucket_id in ('materiais', 'modelos') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "dono_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('materiais', 'modelos') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "dono_storage_update" on storage.objects for update to authenticated
  using (bucket_id in ('materiais', 'modelos') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "dono_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('materiais', 'modelos') and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.fontes_material
  add column if not exists storage_path text,
  add column if not exists tamanho_bytes bigint;

create unique index if not exists idx_fontes_storage_path
  on public.fontes_material (user_id, storage_path) where storage_path is not null;

-- Sem Drive: a origem passa a ser só o Storage.
alter table public.fontes_material alter column origem set default 'storage';
