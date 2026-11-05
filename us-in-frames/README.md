# Us, in Frames — shared photo library

A responsive photo library with a minimal editorial gallery. Supabase Auth protects access, private Supabase Storage holds images, Postgres stores captions and paths, and Realtime propagates changes between signed-in devices.

## Project structure

- `index.html` — authenticated gallery. It restores the Supabase session before revealing the page and redirects signed-out visitors to `login.html`.
- `login.html` / `login.js` — dedicated sign-in screen and redirect flow.
- `app.js` — gallery loading, uploads, captions, deletion, and realtime refresh.
- `supabase-client.js` — shared Supabase client, configuration validation, persistent auth, and Auth request timeout.
- `supabase-config.js` — browser-safe Supabase Project URL and publishable/anon key.
- `supabase-setup.sql` — private bucket, database table, RLS policies, and Realtime setup.
- `.vscode/settings.json` — Live Server port setting.

The unused `src/pages/` mock pages have been removed. The repository root `index.html` redirects to `us-in-frames/login.html` so opening Live Server from the repository root remains convenient.

## Run in VS Code

1. Configure Supabase by following the setup steps below.
2. Open the repository root `index.html` or `us-in-frames/login.html` in VS Code.
3. Start Live Server. If serving the repository root, its entry page redirects to the login screen.
4. Sign in with an invited Supabase Auth account. The library opens at `us-in-frames/index.html`.

## Supabase setup

1. Create a Supabase project and open **SQL Editor**.
2. Run [`supabase-setup.sql`](supabase-setup.sql). It creates `public.photos`, enables row level security, creates the private `us-in-frames` bucket and authenticated-user policies, and adds the table to Realtime.
3. Turn off public signups under **Authentication → Settings**. Create an email/password account for each library member under **Authentication → Users**.
4. In **Project Settings → API**, copy the Project URL and the **publishable** key (or legacy `anon` key). Never use a `service_role` key in browser code.
5. Put the values in `supabase-config.js` using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The bucket is private. The app obtains one-hour signed image URLs after authenticated database reads. Anyone holding a signed URL can view that image until the URL expires. Authenticated project users share access to every photo, caption, and delete action, so only invite people who should have that access.

## Existing local photos

When signing in on a browser that has the older IndexedDB library, the app uploads local photos not already present in Supabase and keeps the original local records as a backup. To migrate another device's old local library, sign in there too and leave the page open until migration completes. Keep original image files until you confirm the migration.

## Verify sync

Upload a photo on one device and confirm it appears on another signed-in device. Captions and deletions also sync through Realtime; reopening the page fetches the current library. Check **Storage → us-in-frames** for image files and **Table Editor → photos** for metadata. If synchronization fails, check the browser console, Supabase policies, project config, and network access. The Supabase JavaScript SDK is loaded from jsDelivr, so the page needs internet access.