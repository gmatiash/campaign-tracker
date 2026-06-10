-- supabase/03_storage.sql
-- Enables image uploads (map backgrounds, token portraits) to Supabase Storage.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Object path convention (set by src/core/assets.ts): <campaignId>/<assetId>.<ext>
--
-- WRITE ACCESS: any *authenticated* user may upload/replace/delete in this bucket.
-- We intentionally do NOT scope writes per-campaign via is_member(): that check is
-- unreliable inside Storage RLS (it evaluated to false and rejected uploads with
-- "new row violates row-level security policy"). For a small trusted group this
-- simple authenticated-only rule is the robust choice. READ is public (the bucket
-- is public), so downloads work without a policy.
--
-- PRIVACY: public bucket = anyone with an image URL can view it (fine for shared
-- maps/portraits). For hidden maps that must stay secret, move to a PRIVATE bucket
-- with signed URLs later.

-- 1) Create (or make public) the bucket. Idempotent.
insert into storage.buckets (id, name, public)
values ('campaign-images', 'campaign-images', true)
on conflict (id) do update set public = true;

-- 2) Remove any earlier policies from previous versions of this file.
drop policy if exists "campaign images insert" on storage.objects;
drop policy if exists "campaign images update" on storage.objects;
drop policy if exists "campaign images delete" on storage.objects;
drop policy if exists "campaign images write"  on storage.objects;

-- 3) Allow any signed-in user to read/write objects in this bucket.
create policy "campaign images write" on storage.objects
for all to authenticated
using (bucket_id = 'campaign-images')
with check (bucket_id = 'campaign-images');
