-- supabase/02_members.sql
-- Run this in the Supabase SQL editor if you already ran schema.sql.
-- Adds display names + a GM-only role-change function. Safe to run more than once.

alter table public.campaign_members add column if not exists display_name text;

-- Backfill display names for members who joined before this change.
update public.campaign_members m
set display_name = u.email
from auth.users u
where m.user_id = u.id and m.display_name is null;

-- Capture the display name when new members join.
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

-- GM-only role change; refuses to demote the last GM.
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
