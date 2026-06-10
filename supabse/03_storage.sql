-- supabase/03_storage.sql
-- Enables image uploads (map backgrounds, token portraits) to Supabase Storage.
-- Run once in the Supabase SQL editor, AFTER schema.sql (it reuses public.is_member).
--
-- Object path convention (set by src/core/assets.ts):
--     <campaignId>/<assetId>.<ext>      e.g.  camp-1/asset-abc123.png
-- so the first folder segment is the campaign id, which we authorize against.
--
-- NOTE ON PRIVACY: this bucket is PUBLIC, so anyone who has an image's URL can
-- view it (URLs include the campaign + asset id but are not secret). That is fine
-- for shared battle maps and portraits. If you later add fog of war / hidden maps
-- that must stay secret from players, switch to a PRIVATE bucket and generate
-- short-lived signed URLs at render time instead of storing a public URL.

-- 1) Create (or make public) the bucket. Idempotent.
insert into storage.buckets (id, name, public)
values ('campaign-images', 'campaign-images', true)
on conflict (id) do update set public = true;

-- 2) Write access: only authenticated campaign members may add/replace/delete
--    objects inside their own campaign's folder. Public read is handled by the
--    bucket being public (no SELECT policy required for downloads).
drop policy if exists "campaign images insert" on storage.objects;
create policy "campaign images insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'campaign-images'
  and public.is_member((storage.foldername(name))[1])
);

drop policy if exists "campaign images update" on storage.objects;
create policy "campaign images update"
on storage.objects for update to authenticated
using (
  bucket_id = 'campaign-images'
  and public.is_member((storage.foldername(name))[1])
)
with check (
  bucket_id = 'campaign-images'
  and public.is_member((storage.foldername(name))[1])
);

drop policy if exists "campaign images delete" on storage.objects;
create policy "campaign images delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'campaign-images'
  and public.is_member((storage.foldername(name))[1])
);
