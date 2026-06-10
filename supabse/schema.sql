-- supabase/schema.sql
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- It creates the document store, membership table, security policies, a
-- membership bootstrap function, and enables realtime.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Who belongs to which campaign, and their role.
create table if not exists public.campaign_members (
  campaign_id  text not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'player' check (role in ('gm', 'player')),
  display_name text,
  primary key (campaign_id, user_id)
);

-- One row per domain record. The full document lives in `doc`; the other
-- columns are promoted copies used for indexing and row-level security.
create table if not exists public.records (
  id             text primary key,
  collection     text not null,
  campaign_id    text not null,
  owner_id       uuid not null,
  visibility     jsonb not null default '{"kind":"party"}',
  deleted_at     bigint,
  updated_at     bigint not null,
  schema_version int not null default 1,
  doc            jsonb not null
);

create index if not exists records_campaign_collection_idx on public.records (campaign_id, collection);
create index if not exists records_campaign_idx on public.records (campaign_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER bypasses RLS, so no policy recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_member(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = cid and user_id = auth.uid()
  );
$$;

create or replace function public.is_gm(cid text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = cid and user_id = auth.uid() and role = 'gm'
  );
$$;

-- Join a campaign. First member to join becomes the GM; everyone after is a player.
create or replace function public.ensure_membership(cid text)
returns void language plpgsql security definer set search_path = public as $$
declare has_gm boolean;
begin
  if exists (select 1 from public.campaign_members where campaign_id = cid and user_id = auth.uid()) then
    return;
  end if;
  select exists (select 1 from public.campaign_members where campaign_id = cid and role = 'gm') into has_gm;
  insert into public.campaign_members (campaign_id, user_id, role, display_name)
  values (cid, auth.uid(), case when has_gm then 'player' else 'gm' end,
          coalesce(auth.email(), left(auth.uid()::text, 8)));
end;
$$;

grant execute on function public.ensure_membership(text) to authenticated;

-- Change a member's role. GM-only, and refuses to demote the last GM.
create or replace function public.set_member_role(cid text, target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gm(cid) then raise exception 'only a GM can change roles'; end if;
  if new_role not in ('gm', 'player') then raise exception 'invalid role'; end if;
  if new_role = 'player'
     and exists (select 1 from public.campaign_members where campaign_id = cid and user_id = target and role = 'gm')
     and (select count(*) from public.campaign_members where campaign_id = cid and role = 'gm') <= 1 then
    raise exception 'cannot demote the last GM';
  end if;
  update public.campaign_members set role = new_role where campaign_id = cid and user_id = target;
end;
$$;

grant execute on function public.set_member_role(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.campaign_members enable row level security;
alter table public.records enable row level security;

-- Members can see the membership of their own campaigns.
drop policy if exists cm_select on public.campaign_members;
create policy cm_select on public.campaign_members for select to authenticated
  using (public.is_member(campaign_id));

-- Records: read if you're a member AND (it isn't GM-only OR you are the GM).
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    public.is_member(campaign_id)
    and ((visibility->>'kind') is distinct from 'gmOnly' or public.is_gm(campaign_id))
  );

-- Insert your own records into a campaign you belong to.
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.is_member(campaign_id) and owner_id = auth.uid());

-- Update records you own, or any record if you are the GM.
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.is_member(campaign_id) and (owner_id = auth.uid() or public.is_gm(campaign_id)))
  with check (public.is_member(campaign_id) and (owner_id = auth.uid() or public.is_gm(campaign_id)));

-- Hard deletes are GM-only (the app soft-deletes via update, so this is a backstop).
drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (public.is_gm(campaign_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Broadcast row changes so other clients live-update. Postgres-changes respects
-- the SELECT policy above for authenticated subscribers. Guarded so re-running
-- this script does not fail with "already member of publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
