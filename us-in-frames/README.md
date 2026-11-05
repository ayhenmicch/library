# Us, in Frames — shared photo library

A responsive photo library with a minimal editorial gallery. Every authenticated account has a separate private library. Supabase Auth protects access, private Supabase Storage holds images under the owner's UUID folder, Postgres stores captions and ownership, and Realtime is filtered to the current owner.

## Project structure

- `index.html` — authenticated gallery. It restores the Supabase session before revealing the page and redirects signed-out visitors to `login.html`.
- `login.html` / `login.js` — dedicated sign-in screen and redirect flow.
- `app.js` — gallery loading, uploads, captions, deletion, and realtime refresh.
- `supabase-client.js` — shared Supabase client, configuration validation, persistent auth, and Auth request timeout.
- `supabase-config.js` — browser-safe Supabase Project URL and publishable/anon key.
- `supabase-setup.sql` — private bucket, database table, RLS policies, and Realtime setup.
- `supabase-user-isolation-migration.sql` — safe ownership and policy migration for an existing project.
- `.vscode/settings.json` — Live Server port setting.

The unused `src/pages/` mock pages have been removed. The repository root `index.html` redirects to `us-in-frames/login.html` so opening Live Server from the repository root remains convenient.

## Run in VS Code

1. Configure Supabase by following the setup steps below.
2. Open the repository root `index.html` or `us-in-frames/login.html` in VS Code.
3. Start Live Server. If serving the repository root, its entry page redirects to the login screen.
4. Sign in with an invited Supabase Auth account. The library opens at `us-in-frames/index.html`.

## Supabase setup

1. Create a Supabase project and open **SQL Editor**.
2. For a new project, run [`supabase-setup.sql`](supabase-setup.sql). For the existing project with photos, review and run [`supabase-user-isolation-migration.sql`](supabase-user-isolation-migration.sql) instead. Do not run the fresh-project script over the existing photo table.
3. Turn off public signups under **Authentication → Settings**. Create an email/password account for each library member under **Authentication → Users**.
4. In **Project Settings → API**, copy the Project URL and the **publishable** key (or legacy `anon` key). Never use a `service_role` key in browser code.
5. Put the values in `supabase-config.js` using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The bucket is private. The app obtains one-hour signed image URLs after owner-filtered authenticated database reads. Anyone holding a signed URL can view that image until the URL expires. RLS permits each account to read, add, edit, and delete only its own rows and files.

## Existing local photos

The prior IndexedDB importer could upload local records under whichever account happened to sign in, so the current app deliberately does not auto-import local photos. Those local browser records are left untouched. The SQL migration can assign Supabase rows to an owner only when a matching direct-upload object has a recorded authenticated Storage `owner_id`; it excludes `legacy.*` browser imports because the uploader may not be the original owner.

Existing objects are stored at old paths that are not user UUID folders. The migration preserves them and their metadata, but the new folder policies keep them inaccessible in the app until you establish each photo's original owner, move/copy its Storage object to `<owner-user-uuid>/<filename>`, verify the new object, then update that row's `user_id` and `storage_path`. The migration file includes an audit query and commented update examples. Leave unverified rows unassigned; they remain inaccessible rather than being exposed to the wrong account. Only set the column `NOT NULL` after every old record has been mapped. Do not delete the old Storage object until its owner-scoped replacement is verified.

## Verify sync

Create or use two test accounts. Upload a unique photo as User A and confirm only A can see it; upload another as User B and confirm only B can see it. Try opening the other user's Storage object and updating/deleting the other user's row through the API; RLS should deny both. Captions and deletes sync for that owner through Realtime; reopening the page fetches that user's current library. Check **Storage → us-in-frames** and **Table Editor → photos**. If a policy test fails, check the browser console, SQL policies, project config, and network access. The Supabase JavaScript SDK is loaded from jsDelivr, so the page needs internet access.
