-- Master backlog 7bm: video rooms on Tutorlage's own WebRTC (design: Drake/programmer/video-rooms-design-v2.md).
-- Rooms, who is in them, and the rules that decide who may enter a room and who may use its signalling channel.
-- No audio, video or recording is ever stored. Only who joined and when.
--
-- Clients cannot read or write these tables at all: the server (service role) calls the functions below and hands
-- back what each person may see. The one thing a signed-in client may do is use a room's Realtime channel
-- ("room:<id>") if the database says they are admitted to that room (the policies on realtime.messages).
-- NOT APPLIED to dev yet (CEO, 9 Oct 2026: database changes are tested in rolled-back runs until Mon 12 Oct, and
-- video rooms need the CEO's yes to switch on). Test: supabase/tests/7bm_video_rooms.sql.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.video_rooms (
  id uuid primary key default gen_random_uuid(),
  -- 8 characters from a 32-letter alphabet (no I, O, 0 or 1), made by the server; unguessable and short enough to share.
  code text not null unique,
  host_id uuid not null references public.profiles(id) on delete cascade,
  -- Set for a session's own room (made when its tutor, learner or guardian first opens it); null for a tutor's room.
  session_id uuid unique references public.sessions(id) on delete cascade,
  max_participants integer not null default 4,
  -- True: calls must go through our relay, so participants' addresses are hidden. The server refuses to hand out
  -- credentials for such a room if no relay is configured.
  relay_only boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  constraint video_rooms_code_shape check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint video_rooms_size check (max_participants between 2 and 4),
  constraint video_rooms_expiry check (expires_at > created_at)
);

create table if not exists public.video_room_members (
  room_id uuid not null references public.video_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  admitted_at timestamptz,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, profile_id),
  constraint video_room_members_status check (status in ('waiting', 'admitted', 'removed', 'left'))
);
create index if not exists video_room_members_profile_idx on public.video_room_members (profile_id);

alter table public.video_rooms enable row level security;
alter table public.video_room_members enable row level security;
-- No policies on purpose: clients get nothing from these tables. Only the service role (the server) uses them.
revoke all on public.video_rooms, public.video_room_members from public, anon, authenticated;
grant select, insert, update, delete on public.video_rooms, public.video_room_members to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Who may use a room's signalling channel (called by the Realtime policies below; answers only for the caller)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.video_room_can_signal(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.video_room_members m
    join public.video_rooms r on r.id = m.room_id
    where m.room_id = p_room
      and m.profile_id = auth.uid()
      and m.status = 'admitted'
      and r.ended_at is null
      and r.expires_at > now()
  );
$$;
revoke all on function public.video_room_can_signal(uuid) from public, anon;
grant execute on function public.video_room_can_signal(uuid) to authenticated, service_role;

drop policy if exists "video room members can receive" on realtime.messages;
create policy "video room members can receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and case
      when realtime.topic() ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.video_room_can_signal(substr(realtime.topic(), 6)::uuid)
      else false
    end
  );

drop policy if exists "video room members can send" on realtime.messages;
create policy "video room members can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and case
      when realtime.topic() ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.video_room_can_signal(substr(realtime.topic(), 6)::uuid)
      else false
    end
  );

-- ---------------------------------------------------------------------------------------------------------
-- Rules (server only). Error messages are short tokens the server maps to HTTP answers.
-- ---------------------------------------------------------------------------------------------------------

-- A tutor opens a room for others to join through a link. Any tutor may, during phase 1. At most 5 open at once.
create or replace function public.create_video_room(
  p_host uuid, p_code text, p_max integer default 4, p_relay_only boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if not exists (select 1 from public.tutor_profiles where id = p_host) then
    raise exception 'only_tutors_create_rooms';
  end if;
  if (select count(*) from public.video_rooms
      where host_id = p_host and session_id is null and ended_at is null and expires_at > now()) >= 5 then
    raise exception 'too_many_open_rooms';
  end if;
  insert into public.video_rooms (code, host_id, max_participants, relay_only, expires_at)
  values (p_code, p_host, p_max, p_relay_only, now() + interval '4 hours')
  returning id into v_room;
  insert into public.video_room_members (room_id, profile_id, status, admitted_at)
  values (v_room, p_host, 'admitted', now());
  return v_room;
end $$;

-- Someone enters a room (internal; the two join functions below call it). Session rooms admit the session's tutor,
-- learner and the learner's linked guardian at once. A tutor's room puts everyone else in the lobby until the tutor
-- admits them, and only adults may use it (a learner under 18 reaches a tutor through a booked session).
create or replace function public.video_room_enter(p_room uuid, p_profile uuid)
returns table (
  room_id uuid, code text, member_status text, is_host boolean,
  max_participants integer, relay_only boolean, session_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r public.video_rooms%rowtype;
  m public.video_room_members%rowtype;
  s record;
  v_exists boolean;
  v_status text;
  v_role public.user_role;
  v_dob date;
  v_admitted integer;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  select role, date_of_birth into v_role, v_dob from public.profiles where id = p_profile;
  if not found then
    raise exception 'not_allowed';
  end if;
  select * into m from public.video_room_members where room_id = p_room and profile_id = p_profile;
  v_exists := found;
  if v_exists and m.status = 'removed' then
    raise exception 'removed';
  end if;

  if p_profile = r.host_id then
    v_status := 'admitted';
  elsif r.session_id is not null then
    select tutor_id, student_id into s from public.sessions where id = r.session_id;
    if not (
      p_profile = s.tutor_id
      or p_profile = s.student_id
      or exists (select 1 from public.parent_student_links l
                 where l.parent_id = p_profile and l.student_id = s.student_id)
    ) then
      raise exception 'not_allowed';
    end if;
    v_status := 'admitted';
  else
    if v_role = 'student' and (v_dob is null or v_dob > (current_date - interval '18 years')::date) then
      raise exception 'adults_only';
    end if;
    v_status := case when v_exists and m.admitted_at is not null then 'admitted' else 'waiting' end;
    if not v_exists and (select count(*) from public.video_room_members
                         where room_id = p_room and status = 'waiting') >= 20 then
      raise exception 'room_full';
    end if;
  end if;

  if v_status = 'admitted' and (not v_exists or m.status is distinct from 'admitted') then
    select count(*) into v_admitted from public.video_room_members
    where room_id = p_room and status = 'admitted' and profile_id <> p_profile;
    if v_admitted >= r.max_participants then
      raise exception 'room_full';
    end if;
  end if;

  insert into public.video_room_members as vm (room_id, profile_id, status, admitted_at, updated_at)
  values (p_room, p_profile, v_status, case when v_status = 'admitted' then now() end, now())
  on conflict (room_id, profile_id) do update
    set status = excluded.status,
        admitted_at = coalesce(vm.admitted_at, excluded.admitted_at),
        updated_at = now();

  return query select r.id, r.code, v_status, (p_profile = r.host_id), r.max_participants, r.relay_only, r.session_id;
end $$;

-- Join a room by its code (a link someone was sent).
create or replace function public.join_video_room(p_code text, p_profile uuid)
returns table (
  room_id uuid, code text, member_status text, is_host boolean,
  max_participants integer, relay_only boolean, session_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_room uuid;
begin
  select id into v_room from public.video_rooms where code = upper(p_code);
  if v_room is null then
    raise exception 'room_closed';
  end if;
  return query select * from public.video_room_enter(v_room, p_profile);
end $$;

-- Open a booked session's own room: made on first use, from 15 minutes before the start until an hour after it
-- should have ended, for a scheduled or running session. Only its tutor, learner or the learner's guardian.
create or replace function public.join_video_session_room(
  p_session uuid, p_profile uuid, p_code text, p_relay_only boolean default false
)
returns table (
  room_id uuid, code text, member_status text, is_host boolean,
  max_participants integer, relay_only boolean, session_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s record;
  v_room uuid;
  v_end timestamptz;
begin
  select tutor_id, student_id, status, scheduled_start, duration_hours into s
  from public.sessions where id = p_session;
  if not found then
    raise exception 'not_allowed';
  end if;
  if not (
    p_profile = s.tutor_id
    or p_profile = s.student_id
    or exists (select 1 from public.parent_student_links l
               where l.parent_id = p_profile and l.student_id = s.student_id)
  ) then
    raise exception 'not_allowed';
  end if;

  select id into v_room from public.video_rooms where session_id = p_session;
  if v_room is null then
    v_end := s.scheduled_start + (s.duration_hours * interval '1 hour') + interval '1 hour';
    if s.status not in ('scheduled', 'in_progress')
       or now() < s.scheduled_start - interval '15 minutes'
       or now() > v_end then
      raise exception 'room_closed';
    end if;
    insert into public.video_rooms (code, host_id, session_id, max_participants, relay_only, expires_at)
    values (p_code, s.tutor_id, p_session, 4, p_relay_only, v_end)
    returning id into v_room;
    insert into public.video_room_members (room_id, profile_id, status, admitted_at)
    values (v_room, s.tutor_id, 'admitted', now());
  end if;
  return query select * from public.video_room_enter(v_room, p_profile);
end $$;

-- The host lets someone out of the lobby in. Fails if the room is full.
create or replace function public.admit_video_room_member(p_room uuid, p_host uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_rooms%rowtype;
  v_status text;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  if r.host_id <> p_host then
    raise exception 'not_host';
  end if;
  select status into v_status from public.video_room_members where room_id = p_room and profile_id = p_profile;
  if v_status is distinct from 'waiting' then
    raise exception 'not_waiting';
  end if;
  if (select count(*) from public.video_room_members where room_id = p_room and status = 'admitted') >= r.max_participants then
    raise exception 'room_full';
  end if;
  update public.video_room_members
  set status = 'admitted', admitted_at = now(), updated_at = now()
  where room_id = p_room and profile_id = p_profile;
end $$;

-- The host removes someone (from the lobby or the call). They cannot come back into this room.
create or replace function public.remove_video_room_member(p_room uuid, p_host uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_rooms%rowtype;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  if r.host_id <> p_host then
    raise exception 'not_host';
  end if;
  if p_profile = r.host_id then
    raise exception 'not_allowed';
  end if;
  update public.video_room_members
  set status = 'removed', updated_at = now()
  where room_id = p_room and profile_id = p_profile and status in ('waiting', 'admitted');
  if not found then
    raise exception 'not_waiting';
  end if;
end $$;

-- Someone leaves. The room stays open for the others.
create or replace function public.leave_video_room(p_room uuid, p_profile uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.video_room_members
  set status = 'left', updated_at = now()
  where room_id = p_room and profile_id = p_profile and status in ('waiting', 'admitted');
$$;

-- The host ends the room for everyone.
create or replace function public.end_video_room(p_room uuid, p_host uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_rooms%rowtype;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null then
    raise exception 'room_closed';
  end if;
  if r.host_id <> p_host then
    raise exception 'not_host';
  end if;
  update public.video_rooms set ended_at = now() where id = p_room;
  update public.video_room_members
  set status = 'left', updated_at = now()
  where room_id = p_room and status in ('waiting', 'admitted');
end $$;

-- What one person may see of a room: the host sees the lobby and the call; an admitted person sees the call; someone
-- waiting sees only themselves. Names come from profiles (full_name).
create or replace function public.video_room_state(p_room uuid, p_profile uuid)
returns table (profile_id uuid, full_name text, status text, is_host boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r public.video_rooms%rowtype;
  v_mine text;
begin
  select * into r from public.video_rooms where id = p_room;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  select m.status into v_mine from public.video_room_members m where m.room_id = p_room and m.profile_id = p_profile;
  if v_mine is null then
    raise exception 'not_allowed';
  end if;
  if v_mine = 'removed' then
    raise exception 'removed';
  end if;
  return query
    select m.profile_id, p.full_name, m.status, (m.profile_id = r.host_id)
    from public.video_room_members m
    join public.profiles p on p.id = m.profile_id
    where m.room_id = p_room
      and (
        (p_profile = r.host_id and m.status in ('waiting', 'admitted'))
        or (v_mine = 'admitted' and m.status = 'admitted')
        or m.profile_id = p_profile
      )
    order by (m.profile_id = r.host_id) desc, m.joined_at;
end $$;

-- Clean-up: rooms ended or expired more than 30 days ago (to be run by a scheduled job once rooms are on).
create or replace function public.purge_old_video_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.video_rooms
  where coalesce(ended_at, expires_at) < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Only the server (service role) may call the rules.
revoke all on function
  public.create_video_room(uuid, text, integer, boolean),
  public.video_room_enter(uuid, uuid),
  public.join_video_room(text, uuid),
  public.join_video_session_room(uuid, uuid, text, boolean),
  public.admit_video_room_member(uuid, uuid, uuid),
  public.remove_video_room_member(uuid, uuid, uuid),
  public.leave_video_room(uuid, uuid),
  public.end_video_room(uuid, uuid),
  public.video_room_state(uuid, uuid),
  public.purge_old_video_rooms()
from public, anon, authenticated;
grant execute on function
  public.create_video_room(uuid, text, integer, boolean),
  public.video_room_enter(uuid, uuid),
  public.join_video_room(text, uuid),
  public.join_video_session_room(uuid, uuid, text, boolean),
  public.admit_video_room_member(uuid, uuid, uuid),
  public.remove_video_room_member(uuid, uuid, uuid),
  public.leave_video_room(uuid, uuid),
  public.end_video_room(uuid, uuid),
  public.video_room_state(uuid, uuid),
  public.purge_old_video_rooms()
to service_role;
