-- Fresh-project setup. For an existing project, use
-- supabase-user-isolation-migration.sql instead.

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  caption text not null default '',
  created_at timestamptz not null default now()
);

alter table public.photos enable row level security;
grant select, insert, update, delete on public.photos to authenticated;
create index if not exists photos_user_id_created_at_idx on public.photos (user_id, created_at desc);

drop policy if exists "Shared library members can read photos" on public.photos;
drop policy if exists "Shared library members can add photos" on public.photos;
drop policy if exists "Shared library members can edit captions" on public.photos;
drop policy if exists "Shared library members can delete photos" on public.photos;
drop policy if exists "Users can read their own photos" on public.photos;
drop policy if exists "Users can add their own photos" on public.photos;
drop policy if exists "Users can edit their own photos" on public.photos;
drop policy if exists "Users can delete their own photos" on public.photos;
drop policy if exists "Restrict photo reads to owner" on public.photos;
drop policy if exists "Restrict photo inserts to owner" on public.photos;
drop policy if exists "Restrict photo updates to owner" on public.photos;
drop policy if exists "Restrict photo deletes to owner" on public.photos;

create policy "Users can read their own photos"
  on public.photos for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add their own photos"
  on public.photos for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can edit their own photos"
  on public.photos for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own photos"
  on public.photos for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Restrict photo reads to owner"
  on public.photos as restrictive for select to public
  using ((select auth.uid()) = user_id);
create policy "Restrict photo inserts to owner"
  on public.photos as restrictive for insert to public
  with check ((select auth.uid()) = user_id);
create policy "Restrict photo updates to owner"
  on public.photos as restrictive for update to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Restrict photo deletes to owner"
  on public.photos as restrictive for delete to public
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('us-in-frames', 'us-in-frames', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Shared library members can read photo objects" on storage.objects;
drop policy if exists "Shared library members can upload photo objects" on storage.objects;
drop policy if exists "Shared library members can delete photo objects" on storage.objects;
drop policy if exists "Users can read their own photo objects" on storage.objects;
drop policy if exists "Users can upload into their own photo folder" on storage.objects;
drop policy if exists "Users can update their own photo objects" on storage.objects;
drop policy if exists "Users can delete their own photo objects" on storage.objects;
drop policy if exists "Restrict photo object reads to owner folder" on storage.objects;
drop policy if exists "Restrict photo object inserts to owner folder" on storage.objects;
drop policy if exists "Restrict photo object updates to owner folder" on storage.objects;
drop policy if exists "Restrict photo object deletes to owner folder" on storage.objects;

create policy "Users can read their own photo objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'us-in-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can upload into their own photo folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'us-in-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can update their own photo objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'us-in-frames' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'us-in-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own photo objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'us-in-frames' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Restrictive guards prevent any broad permissive Storage policy from granting
-- access to another user's objects in this bucket. Other buckets are unaffected.
create policy "Restrict photo object reads to owner folder"
  on storage.objects as restrictive for select to public
  using (bucket_id <> 'us-in-frames' or (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Restrict photo object inserts to owner folder"
  on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'us-in-frames' or (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Restrict photo object updates to owner folder"
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'us-in-frames' or (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id <> 'us-in-frames' or (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Restrict photo object deletes to owner folder"
  on storage.objects as restrictive for delete to public
  using (bucket_id <> 'us-in-frames' or (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.photos replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;
