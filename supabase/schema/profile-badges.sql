-- Afterglow profile roles and public badges.
create table if not exists public.profile_badges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Afterglow' check (char_length(display_name) between 1 and 40),
  role text not null default 'member' check (role in ('member','vip','admin','owner')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profile_badges enable row level security;
drop policy if exists "Public can view profile badges" on public.profile_badges;
create policy "Public can view profile badges" on public.profile_badges
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.profile_badges from anon, authenticated;
grant select on public.profile_badges to anon, authenticated;

create or replace function public.bootstrap_profile_badge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile_badges (user_id, display_name, role, is_verified)
  values (new.id, 'Afterglow', 'member', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.bootstrap_profile_badge() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile_badge on auth.users;
create trigger on_auth_user_created_profile_badge
  after insert on auth.users for each row
  execute procedure public.bootstrap_profile_badge();

insert into public.profile_badges (user_id, display_name, role, is_verified)
select id, coalesce(nullif(username,''),'Afterglow'), 'member', false
from public.profiles
on conflict (user_id) do nothing;

-- Initial Owner account.
update public.profile_badges
set display_name = 'Afterglow', role = 'owner', is_verified = true, updated_at = now()
where user_id = '2c1b1009-0300-4e99-a042-df6489b34248';
