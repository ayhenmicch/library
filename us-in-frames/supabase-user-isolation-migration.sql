-- Existing-project migration for private, per-user photo libraries.
-- Review the preflight results before applying the migration.
-- No photo rows or Storage objects are deleted by this script.

-- Preflight: existing rows and the matching Storage owner, if present.
select p.id, p.storage_path, p.caption,
       to_jsonb(o)->>'owner_id' as storage_owner_candidate,
       (split_part(p.storage_path, '/', 2) like 'legacy.%') as legacy_browser_import
from public.photos p
left join storage.objects o
  on o.bucket_id = 'us-in-frames' and o.name = p.storage_path
order by p.created_at;

begin;

alter table public.photos
  add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_user_id_fkey'
  ) then
    alter table public.photos
      add constraint photos_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photos'::regclass and conname = 'photos_user_id_required'
  ) then
    -- NOT VALID preserves existing NULL rows but enforces non-NULL user_id on
    -- every new or updated row until the old records are manually resolved.
    alter table public.photos
      add constraint photos_user_id_required check (user_id is not null) not valid;
  end if;
end $$;

-- Safely backfill only records created by this app's direct uploader. The
-- Storage owner is the authenticated uploader recorded by Supabase. Exclude
-- `legacy.*`: the previous browser importer could upload someone else's local
-- photo while signed into the importing account, so that owner is ambiguous.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'
  ) then
    execute $sql$
      update public.photos as p
      set user_id = u.id
      from storage.objects as o
      join auth.users as u on u.id::text = o.owner_id::text
      where p.user_id is null
        and o.bucket_id = 'us-in-frames'
        and o.name = p.storage_path
        and split_part(o.name, '/', 2) like 'original.%'
    $sql$;
  end if;
end $$;

alter table public.photos enable row level security;
grant select, insert, update, delete on public.photos to authenticated;
create index if not exists photos_user_id_created_at_idx on public.photos (user_id, created_at desc);

-- Replace all existing policies on this app-owned table so no previous shared
-- policy can continue granting access to another user's rows.
do $$
declare policy_record record;
begin
  for policy_record in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'photos'
  loop
    execute format('drop policy %I on public.photos', policy_record.policyname);
  end loop;
end $$;

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

-- Restrictive owner checks prevent any later broad permissive policy on this
-- table from widening access. RLS stays enabled throughout.
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

-- Keep the bucket private. Fail rather than silently doing nothing if the
-- expected existing bucket is missing.
update storage.buckets set public = false where id = 'us-in-frames';
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'us-in-frames') then
    raise exception 'Expected Storage bucket us-in-frames was not found; no data was removed.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'RLS is not enabled on storage.objects; refusing to apply Storage policies.';
  end if;
end $$;

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

-- These guards also constrain any other permissive policy scoped to this
-- bucket, while leaving other Storage buckets unaffected.
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

-- Filtering Realtime DELETE events by user_id requires FULL replica identity.
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

commit;

-- Review what still needs explicit ownership and path migration:
-- select id, storage_path, user_id from public.photos where user_id is null
--    or split_part(storage_path, '/', 1) <> user_id::text;
--
-- For each row, establish the original owner before changing it. Legacy browser
-- imports (`*/legacy.*`) are intentionally not auto-assigned. After you have
-- verified ownership, move/copy its Storage object in the Supabase Dashboard to
-- <owner-user-uuid>/<filename>, verify the new object, then update metadata:
-- For an unassigned record:
-- update public.photos
-- set user_id = '<verified-auth-user-uuid>',
--     storage_path = '<verified-auth-user-uuid>/<filename>'
-- where id = '<photo-uuid>' and user_id is null;
-- For a record auto-assigned from a verified Storage owner_id, update only
-- storage_path after moving its object to the owner folder:
-- update public.photos set storage_path = '<verified-auth-user-uuid>/<filename>'
-- where id = '<photo-uuid>' and user_id = '<verified-auth-user-uuid>';
-- Do not remove the old Storage object until the new file and row are verified.
--
-- Once every row is assigned and every file path is owner-prefixed, enforce a
-- column-level NOT NULL constraint and validate the transitional check:
-- alter table public.photos alter column user_id set not null;
-- alter table public.photos validate constraint photos_user_id_required;
-- alter table public.photos drop constraint photos_user_id_required;
