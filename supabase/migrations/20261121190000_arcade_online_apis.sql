-- Afterglow Arcade online APIs: public scoreboards, rate limiting and privacy-light analytics.
create table if not exists public.arcade_scores (
  id uuid primary key default gen_random_uuid(),
  game_id text not null check (game_id ~ '^[a-z0-9-]{1,40}$'),
  display_name text not null check (display_name ~ '^[A-Za-z0-9_-]{3,16}$'),
  score bigint not null check (score >= 0 and score <= 1000000000),
  created_at timestamptz not null default now()
);
create index if not exists arcade_scores_game_score_idx
  on public.arcade_scores (game_id, score desc, created_at asc);

create table if not exists public.arcade_score_limits (
  session_id uuid not null,
  game_id text not null,
  last_submitted_at timestamptz not null default now(),
  primary key (session_id, game_id)
);

create table if not exists public.arcade_analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'arcade_open','game_open','game_load_success','game_load_error',
    'leaderboard_view','score_submit','room_create','room_join','room_leave'
  )),
  game_id text check (game_id is null or game_id ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now()
);
create index if not exists arcade_analytics_created_idx
  on public.arcade_analytics_events (created_at desc);

alter table public.arcade_scores enable row level security;
alter table public.arcade_score_limits enable row level security;
alter table public.arcade_analytics_events enable row level security;

revoke all on public.arcade_scores from anon, authenticated;
revoke all on public.arcade_score_limits from anon, authenticated;
revoke all on public.arcade_analytics_events from anon, authenticated;
grant all on public.arcade_scores to service_role;
grant all on public.arcade_score_limits to service_role;
grant all on public.arcade_analytics_events to service_role;
grant usage, select on sequence public.arcade_analytics_events_id_seq to service_role;

create or replace function public.record_arcade_score(
  p_game_id text,
  p_score bigint,
  p_display_name text,
  p_session_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rate_session uuid;
  v_score_id uuid;
begin
  if p_game_id !~ '^[a-z0-9-]{1,40}$'
     or p_score < 0 or p_score > 1000000000
     or p_display_name !~ '^[A-Za-z0-9_-]{3,16}$'
     or p_session_id is null then
    raise exception 'Invalid score submission';
  end if;

  insert into public.arcade_score_limits (session_id, game_id, last_submitted_at)
  values (p_session_id, p_game_id, pg_catalog.now())
  on conflict (session_id, game_id) do update
    set last_submitted_at = pg_catalog.now()
    where public.arcade_score_limits.last_submitted_at < pg_catalog.now() - interval '10 seconds'
  returning session_id into v_rate_session;

  if v_rate_session is null then
    raise exception 'Please wait before submitting another score';
  end if;

  insert into public.arcade_scores (game_id, display_name, score)
  values (p_game_id, p_display_name, p_score)
  returning id into v_score_id;
  return v_score_id;
end;
$$;

revoke all on function public.record_arcade_score(text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.record_arcade_score(text,bigint,text,uuid) to service_role;
