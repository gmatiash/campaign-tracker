# Cloud backend — Supabase (sync, auth, RLS, storage)

The app runs **local-only by default**. When the two `VITE_SUPABASE_*` env vars are
present at build time it switches to **cloud mode**: email sign-in, multi-device sync,
realtime updates, server-enforced permissions, and image storage. No code changes flip
modes — only env vars.

## 1. Create a Supabase project (free tier)
1. Sign up at https://supabase.com and create a project.
2. After it provisions, collect two values:
   - **Project Settings → Data API → Project URL** → `VITE_SUPABASE_URL`
     (looks like `https://<ref>.supabase.co`)
   - **Project Settings → API Keys → Publishable key** (`sb_publishable_…`) →
     `VITE_SUPABASE_PUBLISHABLE_KEY`
   The publishable key is meant to be public; Row-Level Security protects the data.
   **Never** put the **Secret key** (`sb_secret_…`) in the app — it bypasses RLS.

## 2. Create the schema
Open **SQL Editor → New query**, paste each file, and run **in order**:
1. [`supabase/schema.sql`](./supabase/schema.sql) — the `records` document store, the
   `campaign_members` table, RLS policies, the `ensure_membership` bootstrap function,
   and realtime.
2. [`supabase/02_members.sql`](./supabase/02_members.sql) — adds `display_name` and the
   `set_member_role` function used by the **Members** panel.
3. [`supabase/03_storage.sql`](./supabase/03_storage.sql) — creates the public
   `campaign-images` bucket and a write policy (see Storage below).

Each file is idempotent; re-running is safe. An "already member of publication" notice
on re-run is harmless.

## 3. Configure auth (magic link)
1. **Authentication → Providers → Email**: keep **Email** enabled. The app uses a
   passwordless magic link (`signInWithOtp`); no password setup needed.
2. **Authentication → URL Configuration → Redirect URLs**: add
   - `http://localhost:5173/campaign-tracker/` (local dev)
   - `https://YOUR-USER.github.io/campaign-tracker/` (deployed)
   Set **Site URL** to the deployed URL.

## 4. Run locally against Supabase
1. Copy `.env.example` to `.env.local` and fill in the two values. (Vite reads
   `.env.local`, **not** `.env.example`; restart `npm run dev` after editing it.)
2. `npm install` then `npm run dev`.
3. You get a sign-in screen — enter your email, click the link, and you're in. The
   first account to open the demo campaign becomes its **GM**; later accounts join as
   **players**.

## 5. Image storage
Map backgrounds and token portraits are uploaded to **Supabase Storage** (bucket
`campaign-images`); records keep only a short public URL instead of inline base64.

- Run `supabase/03_storage.sql` once. It creates the public bucket and a policy that
  lets **any signed-in user** read/write the bucket. (An earlier per-campaign
  `is_member()` write check proved unreliable inside Storage RLS and rejected uploads;
  the authenticated-only policy is the robust choice for a small trusted group.)
- If Storage isn't set up, uploads **fall back to inline data URLs** and the app still
  works; the browser console logs the exact reason.
- After a successful upload you'll see a `camp-1/` folder appear in the bucket. Images
  that previously fell back to data URLs stay that way until re-uploaded.

**Privacy:** the bucket is public, so anyone with an image URL can view it (fine for
shared maps/portraits). For hidden maps that must stay secret, move to a private bucket
with signed URLs.

## 6. Deploy with cloud mode on GitHub Pages
1. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Push to `main`. The workflow injects them into the Vite build (`deploy.yml`), so the
   deployed site runs in cloud mode. Without the secrets it deploys local-only.

> Connecting Supabase's GitHub integration in the dashboard (DB branching/migrations)
> does **not** set these build variables for Pages — you still add the two secrets above.

## How permissions work
- **Membership** — `records` are readable/writable only by members of the record's
  campaign. `ensure_membership(campaign_id)` adds the signed-in user (GM if first, else
  player). To invite, share the app URL (the **Invite** button copies it); they join the
  same campaign when they sign in.
- **Ownership / GM** — you may edit records you own; the GM may edit anything. Destructive
  actions (Reset to demo, New combat in cloud) are effectively GM-only via RLS.
- **GM-only secrecy hook** — a record saved with `visibility.kind = "gmOnly"` is hidden
  from players by the `records_select` policy.

## Honest limitations (for later hardening)
- **Single demo campaign id.** Everything uses `camp-1`; a multi-campaign UI is a
  follow-up. The data model and membership table already support it.
- **Fog of war is client-side.** Fog/wall data is in the shared map record, so a player's
  browser receives it and just doesn't render hidden areas. Screen-shared play is fully
  secret; players on their own devices have presentational, not cryptographic, secrecy.
  True secrecy needs GM-only records and/or Realtime Authorization (private channels).
- **Realtime payloads** respect the SELECT policy and this client re-reads through RLS
  before emitting, so players can't *read* gmOnly rows; strict secrecy of change
  *notifications* needs Realtime Authorization.
- **Run this against your own project** to verify end to end — it ships as code + SQL.
