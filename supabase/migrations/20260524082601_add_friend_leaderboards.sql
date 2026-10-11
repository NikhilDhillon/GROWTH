create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  user_low uuid generated always as (least(requester_id, addressee_id)) stored,
  user_high uuid generated always as (greatest(requester_id, addressee_id)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (user_low, user_high)
);

create table if not exists public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.leaderboard_score_snapshots (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id bigint not null references public.exercises(id) on delete cascade,
  exercise_name text not null,
  best_score numeric not null,
  achieved_at date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table public.friendships enable row level security;
alter table public.friend_invites enable row level security;
alter table public.leaderboard_score_snapshots enable row level security;

drop policy if exists "profiles are visible to accepted friends" on public.profiles;
drop policy if exists "friendships are visible to participants" on public.friendships;
drop policy if exists "friendships can be created by participants" on public.friendships;
drop policy if exists "friendships can be updated by participants" on public.friendships;
drop policy if exists "friendships can be deleted by participants" on public.friendships;
drop policy if exists "friend invites are owned by their user" on public.friend_invites;
drop policy if exists "score snapshots are visible to friends" on public.leaderboard_score_snapshots;
drop policy if exists "score snapshots are owned by their user" on public.leaderboard_score_snapshots;

create policy "profiles are visible to accepted friends" on public.profiles
  for select using (
    auth.uid() is not null
    and exists (
      select 1
      from public.friendships
      where status = 'accepted'
        and (
          (requester_id = auth.uid() and addressee_id = profiles.id)
          or (addressee_id = auth.uid() and requester_id = profiles.id)
        )
    )
  );

create policy "friendships are visible to participants" on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));

create policy "friendships can be created by participants" on public.friendships
  for insert with check (auth.uid() in (requester_id, addressee_id));

create policy "friendships can be updated by participants" on public.friendships
  for update using (auth.uid() in (requester_id, addressee_id)) with check (auth.uid() in (requester_id, addressee_id));

create policy "friendships can be deleted by participants" on public.friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

create policy "friend invites are owned by their user" on public.friend_invites
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "score snapshots are visible to friends" on public.leaderboard_score_snapshots
  for select using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.friendships
      where status = 'accepted'
        and (
          (requester_id = auth.uid() and addressee_id = leaderboard_score_snapshots.user_id)
          or (addressee_id = auth.uid() and requester_id = leaderboard_score_snapshots.user_id)
        )
    )
  );

create policy "score snapshots are owned by their user" on public.leaderboard_score_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists friendships_requester_id_idx on public.friendships(requester_id);
create index if not exists friendships_addressee_id_idx on public.friendships(addressee_id);
create index if not exists friend_invites_owner_id_idx on public.friend_invites(owner_id);
create index if not exists friend_invites_token_idx on public.friend_invites(token);
create index if not exists leaderboard_score_snapshots_exercise_score_idx on public.leaderboard_score_snapshots(exercise_id, best_score desc);

create or replace function public.accept_friend_invite(invite_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.friend_invites%rowtype;
  accepting_user uuid := auth.uid();
begin
  if accepting_user is null then
    raise exception 'Please log in again.';
  end if;

  select *
  into invite_row
  from public.friend_invites
  where token = invite_token
    and accepted_by is null
    and expires_at > now()
  limit 1;

  if invite_row.id is null then
    raise exception 'This invite is expired or has already been used.';
  end if;

  if invite_row.owner_id = accepting_user then
    raise exception 'You cannot accept your own invite.';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (invite_row.owner_id, accepting_user, 'accepted')
  on conflict (user_low, user_high)
  do update set status = 'accepted', updated_at = now();

  update public.friend_invites
  set accepted_by = accepting_user
  where id = invite_row.id;
end;
$$;

grant execute on function public.accept_friend_invite(text) to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;
grant select, insert, update, delete on public.friend_invites to authenticated;
grant select, insert, update, delete on public.leaderboard_score_snapshots to authenticated;;
