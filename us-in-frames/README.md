# Us, in Frames — shared photo library

The gallery keeps its existing HTML/CSS design. Supabase Auth protects the shared library, private Supabase Storage holds the image files, and Postgres stores captions and image paths. Realtime database changes update other open devices. IndexedDB is read only to migrate photos from the previous local-only version; it is no longer the library's source of truth.

## Supabase setup

1. Create a Supabase project and open **SQL Editor**.
2. Run the contents of [`supabase-setup.sql`](supabase-setup.sql). This creates `public.photos`, enables row level security, creates the private `us-in-frames` bucket and its authenticated-user policies, and adds the table to Realtime.
3. In **Authentication → Settings**, turn off public signups. Under **Authentication → Users**, create an email/password user for each of you. Use strong, unique passwords. Both accounts can read and edit this shared library.
4. In **Project Settings → API**, copy the Project URL and the **publishable** key (or legacy `anon` key). Do not use or share the `service_role` key.
5. Open [`supabase-config.js`](supabase-config.js) and replace `YOUR_PROJECT_REF` in the URL and `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY` with those two public values. This key is intended for browser use; RLS and Storage policies enforce access. Do not commit personal credentials to a public repository.
6. Serve the `us-in-frames` folder over HTTP(S) with Live Server. Open `login.html` and sign in on each device using one of the invited accounts. Successful sign-in redirects to `index.html`; direct visits to the library redirect back to login when there is no saved session. A static site hosted publicly is okay only when these policies remain enabled and signups stay off.

The bucket is **private**. The website asks Supabase for one-hour signed image URLs after authenticated database reads. Anyone holding a signed URL can view that individual image until the URL expires, so avoid sharing those links. The Storage `SELECT` policy is needed to create the signed URLs; it does not make the bucket public. Every authenticated project user can access all photos, captions, and deletion controls, so only invite people who should share the entire library.

## Existing IndexedDB photos

After configuring Supabase, sign in on the browser/device that has the old library. On sign-in the app reads the existing `us-in-frames` IndexedDB `photos` store, uploads records missing from Supabase, and keeps the old local records as a backup. It skips IDs already present remotely so refreshing or signing in again does not re-upload migrated records. If an upload is rejected, the local originals remain available in that browser for a later retry. Keep original photo files as a separate backup until you confirm the migration in Supabase.

Each browser has its own IndexedDB. To migrate another device's old local-only library, sign in on that device as well and leave the page open until migration finishes.

## Sign-in and verify sync

The browser session is persisted by Supabase Auth and restored on refresh. Sign out from the library header to clear that session. Login requests time out after 18 seconds and display an error; rapid repeat submissions are ignored while a request is active.

- Add photos from either device. The image is uploaded to Storage and its row is saved in Postgres.
- Captions are saved to the shared `photos` row; deletes remove the database row and Storage object.
- Leave the page open on another signed-in device. Realtime changes appear there. Reopening the page also loads the current remote library.
- Confirm uploads appear under **Storage → us-in-frames** and captions/paths under **Table Editor → photos**.

If the page says **Configuration needed**, check `supabase-config.js`. If it says **Sync unavailable**, inspect the browser console and confirm the SQL setup, bucket policies, Auth users, and network access. The Supabase JavaScript client is loaded from jsDelivr, so the site needs internet access.
