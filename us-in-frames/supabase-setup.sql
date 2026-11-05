-- Run once in Supabase Dashboard > SQL Editor.
-- This creates a private Storage bucket, a shared metadata table, and RLS policies.

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  caption text not null default '',
  created_at timestamptz not null default now()
);

alter table public.photos enable row level security;
grant select, insert, update, delete on public.photos to authenticated;

drop policy if exists "Shared library members can read photos" on public.photos;
create policy "Shared library members can read photos"
  on public.photos for select to authenticated using (true);

drop policy if exists "Shared library members can add photos" on public.photos;
create policy "Shared library members can add photos"
  on public.photos for insert to authenticated with check (true);

drop policy if exists "Shared library members can edit captions" on public.photos;
create policy "Shared library members can edit captions"
  on public.photos for update to authenticated using (true) with check (true);

drop policy if exists "Shared library members can delete photos" on public.photos;
create policy "Shared library members can delete photos"
  on public.photos for delete to authenticated using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('us-in-frames', 'us-in-frames', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Shared library members can read photo objects" on storage.objects;
create policy "Shared library members can read photo objects"
  on storage.objects for select to authenticated using (bucket_id = 'us-in-frames');

drop policy if exists "Shared library members can upload photo objects" on storage.objects;
create policy "Shared library members can upload photo objects"
  on storage.objects for insert to authenticated with check (bucket_id = 'us-in-frames');

drop policy if exists "Shared library members can delete photo objects" on storage.objects;
create policy "Shared library members can delete photo objects"
  on storage.objects for delete to authenticated using (bucket_id = 'us-in-frames');

-- Enable live cross-device changes. Safe to run repeatedly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;
