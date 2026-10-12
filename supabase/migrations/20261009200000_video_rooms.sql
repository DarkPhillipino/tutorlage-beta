-- Master backlog 7bm: video rooms on Tutorlage's own WebRTC (design: Drake/programmer/video-rooms-design-v2.md).
-- Rooms, who is in them, and the rules that decide who may enter a room and who may use its signalling channel.
-- No audio, video or recording is ever stored. Only who joined and when.
--
-- Clients cannot read or write these tables at all: the server (service role) calls the functions below and hands
-- back what each person may see. The one thing a signed-in client may do is use a room's Realtime channel
-- ("room:<id>") if the database says they are admitted to that room (the policies on realtime.messages).
--
-- Seats and the heartbeat (10 Oct 2026): the open room page tells the database it is still there every ~25 seconds
-- (heartbeat_video_room). Someone silent for longer than video_room_seat_timeout() (90 seconds: a closed tab, a
-- crash, a dead connection) stops counting toward the room's size and the lobby, so their seat is free for someone
-- else, and they may come back in. All times are the DATABASE's clock (now()), never the browser's. Each page visit
-- has a random id; a newer visit by the same person (another tab or device, or after a crash) takes over, and the
-- older one is told ("superseded") and cannot change anything. Seats are counted under a lock on the room's row, so
-- two people arriving at the same moment cannot both take the last seat. The host's own place is always kept for
-- them: a room holds its host plus up to (max_participants - 1) guests, so a host who has been silent for a while (a
-- sleeping laptop) can always come back, and nobody can take the seat of a host who has not arrived yet.
--
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
  -- The database's clock at the person's last sign of life: joining, or a heartbeat from their open page.
  last_seen_at timestamptz not null default now(),
  -- The page visit that holds this place (a random id made by the page). Null only for a row made by the server itself.
  visit_id uuid,
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
-- How long someone may be silent before their seat stops counting. The page beats every ~25 seconds, so this
-- allows three missed beats, and a page whose timers a browser slows to one a minute still stays in.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.video_room_seat_timeout()
returns interval
language sql
immutable
set search_path = public
as $$ select interval '90 seconds' $$;

-- How many of a room's guests (everyone except its host) hold a seat right now: admitted and heard from within the
-- timeout. p_except leaves one person out of the count (the one who is asking). A guest may only be seated while this
-- is below max_participants - 1, because the host's place is always kept. Used under the lock on the room's row.
create or replace function public.video_room_guests_seated(p_room uuid, p_except uuid default null)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.video_room_members x
  join public.video_rooms r on r.id = x.room_id
  where x.room_id = p_room
    and x.profile_id <> r.host_id
    and (p_except is null or x.profile_id <> p_except)
    and x.status = 'admitted'
    and x.last_seen_at > now() - public.video_room_seat_timeout();
$$;

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
      and m.last_seen_at > now() - public.video_room_seat_timeout()
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

-- Someone enters a room (internal; join_video_room calls it). Session rooms admit the session's tutor, learner and
-- the learner's linked guardian at once. A tutor's room puts everyone else in the lobby until the tutor admits them,
-- and only adults may use it (a learner under 18 reaches a tutor through a booked session). The room's row is locked
-- first, so the seat count below cannot be raced by someone entering at the same moment. Only people who have been
-- heard from within video_room_seat_timeout() count as seated; entering again (a new visit) takes the place over.
create or replace function public.video_room_enter(p_room uuid, p_profile uuid, p_visit uuid default null)
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
  v_guests integer;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  select role, date_of_birth into v_role, v_dob from public.profiles where id = p_profile;
  if not found then
    raise exception 'not_allowed';
  end if;
  -- A cancelled session has no room for anyone, its tutor included.
  if r.session_id is not null then
    select tutor_id, student_id, status into s from public.sessions where id = r.session_id;
    if s.status in ('cancelled_by_tutor', 'cancelled_by_student') then
      raise exception 'room_closed';
    end if;
  end if;
  select * into m from public.video_room_members where room_id = p_room and profile_id = p_profile;
  v_exists := found;
  if v_exists and m.status = 'removed' then
    raise exception 'removed';
  end if;

  if p_profile = r.host_id then
    v_status := 'admitted';
  elsif r.session_id is not null then
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
    if not v_exists and (select count(*) from public.video_room_members x
                         where x.room_id = p_room and x.status = 'waiting'
                           and x.last_seen_at > now() - public.video_room_seat_timeout()) >= 20 then
      raise exception 'room_full';
    end if;
  end if;

  -- A guest needs a free seat; the host's own place is always kept, so the host never needs one.
  if v_status = 'admitted' and p_profile <> r.host_id then
    select public.video_room_guests_seated(p_room, p_profile) into v_guests;
    if v_guests >= r.max_participants - 1 then
      raise exception 'room_full';
    end if;
  end if;

  insert into public.video_room_members as vm (room_id, profile_id, status, admitted_at, visit_id, last_seen_at, updated_at)
  values (p_room, p_profile, v_status, case when v_status = 'admitted' then now() end, p_visit, now(), now())
  on conflict (room_id, profile_id) do update
    set status = excluded.status,
        admitted_at = coalesce(vm.admitted_at, excluded.admitted_at),
        visit_id = excluded.visit_id,
        last_seen_at = now(),
        updated_at = now();

  return query select r.id, r.code, v_status, (p_profile = r.host_id), r.max_participants, r.relay_only, r.session_id;
end $$;

-- Join a room by its code (a link someone was sent). p_visit: the id of this page visit (see the header).
create or replace function public.join_video_room(p_code text, p_profile uuid, p_visit uuid default null)
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
  return query select * from public.video_room_enter(v_room, p_profile, p_visit);
end $$;

-- A booked session's own room: made on first use, from 15 minutes before the start until an hour after it should
-- have ended, for a scheduled or running session. Only its tutor, learner or the learner's guardian may ask for it.
-- This hands back the room's code and enters nobody: the page then joins by code like any other room, and the
-- rules in video_room_enter admit exactly those three kinds of people. If two people ask at the same moment the
-- room is made once (the session can have only one room).
create or replace function public.open_video_session_room(
  p_session uuid, p_profile uuid, p_code text, p_relay_only boolean default false
)
returns table (room_id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s record;
  r public.video_rooms%rowtype;
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

  -- A cancelled session has no room, even one that was already made.
  if s.status in ('cancelled_by_tutor', 'cancelled_by_student') then
    raise exception 'room_closed';
  end if;

  select * into r from public.video_rooms where session_id = p_session;
  if found then
    if r.ended_at is not null or r.expires_at <= now() then
      raise exception 'room_closed';
    end if;
    return query select r.id, r.code;
    return;
  end if;

  v_end := s.scheduled_start + (s.duration_hours * interval '1 hour') + interval '1 hour';
  if s.status not in ('scheduled', 'in_progress')
     or now() < s.scheduled_start - interval '15 minutes'
     or now() >= v_end then
    raise exception 'room_closed';
  end if;
  insert into public.video_rooms (code, host_id, session_id, max_participants, relay_only, expires_at)
  values (p_code, s.tutor_id, p_session, 4, p_relay_only, v_end)
  on conflict (session_id) do nothing
  returning id into v_room;
  if v_room is null then
    -- Someone else made it in the same moment: use theirs.
    select * into r from public.video_rooms where session_id = p_session;
    if not found or r.ended_at is not null or r.expires_at <= now() then
      raise exception 'room_closed';
    end if;
    return query select r.id, r.code;
    return;
  end if;
  -- Nobody is entered here, not even the tutor: each person is entered when their page joins by code, so the room
  -- never lists someone who has not arrived.
  return query select vr.id, vr.code from public.video_rooms vr where vr.id = v_room;
end $$;

-- The host lets someone out of the lobby in. Fails if the room is full, or if the person is no longer there
-- (their page stopped beating, so they have probably closed it).
create or replace function public.admit_video_room_member(p_room uuid, p_host uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_rooms%rowtype;
  v_status text;
  v_seen timestamptz;
  v_guests integer;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  if r.host_id <> p_host then
    raise exception 'not_host';
  end if;
  select status, last_seen_at into v_status, v_seen
  from public.video_room_members where room_id = p_room and profile_id = p_profile;
  if v_status is distinct from 'waiting' or v_seen <= now() - public.video_room_seat_timeout() then
    raise exception 'not_waiting';
  end if;
  select public.video_room_guests_seated(p_room, p_profile) into v_guests;
  if v_guests >= r.max_participants - 1 then
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
  -- A booked session's room admits only its own tutor, learner and the learner's guardian, so everyone in it has a right
  -- to be there: the tutor (its host) cannot send the learner or the guardian away. (Review of 12 Oct 2026.)
  if r.session_id is not null then
    raise exception 'session_room';
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

-- Someone leaves. The room stays open for the others. p_visit: a "leave" from an older page visit (a tab that was
-- closed late, after the person came back from another tab) changes nothing; without p_visit it applies.
create or replace function public.leave_video_room(p_room uuid, p_profile uuid, p_visit uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.video_room_members
  set status = 'left', updated_at = now()
  where room_id = p_room and profile_id = p_profile and status in ('waiting', 'admitted')
    and (p_visit is null or visit_id is null or visit_id = p_visit);
$$;

-- The open page says it is still there. Answers with the person's place as the database sees it:
--   'admitted' / 'waiting'  all well (the time of last sign of life is refreshed with the database's clock)
--   'removed'               the host removed them
--   'left'                  they are not in the room any more (they left, or their seat went to someone else while they
--                           were silent): the page joins again, which checks the room's size
--   'superseded'            a newer visit by the same person holds the place: this page must stop
-- Refused: someone who was never in the room ('not_allowed'); a room that has ended or expired ('room_closed').
-- Someone who was silent past the timeout and is still marked admitted gets their seat back only if it is still free
-- (the host's place is always free for the host).
create or replace function public.heartbeat_video_room(p_room uuid, p_profile uuid, p_visit uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.video_rooms%rowtype;
  m public.video_room_members%rowtype;
  v_guests integer;
begin
  select * into r from public.video_rooms where id = p_room for update;
  if not found or r.ended_at is not null or r.expires_at <= now() then
    raise exception 'room_closed';
  end if;
  select * into m from public.video_room_members x where x.room_id = p_room and x.profile_id = p_profile;
  if not found then
    raise exception 'not_allowed';
  end if;
  if m.status = 'removed' then
    return 'removed';
  end if;
  if m.visit_id is not null and p_visit is not null and m.visit_id <> p_visit then
    return 'superseded';
  end if;
  if m.status = 'left' then
    return 'left';
  end if;
  if m.status = 'admitted' and p_profile <> r.host_id and m.last_seen_at <= now() - public.video_room_seat_timeout() then
    select public.video_room_guests_seated(p_room, p_profile) into v_guests;
    if v_guests >= r.max_participants - 1 then
      update public.video_room_members
      set status = 'left', updated_at = now()
      where room_id = p_room and profile_id = p_profile;
      return 'left';
    end if;
  end if;
  update public.video_room_members
  set last_seen_at = now()
  where room_id = p_room and profile_id = p_profile;
  return m.status;
end $$;

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
  -- A booked session's room cannot be ended by one person: that would lock the learner and the guardian out of a lesson
  -- that was paid for. It closes by itself an hour after the session should have ended; everyone can simply leave.
  if r.session_id is not null then
    raise exception 'session_room';
  end if;
  update public.video_rooms set ended_at = now() where id = p_room;
  update public.video_room_members
  set status = 'left', updated_at = now()
  where room_id = p_room and status in ('waiting', 'admitted');
end $$;

-- What one person may see of a room: the host sees the lobby and the call; an admitted person sees the call; someone
-- waiting sees only themselves. Names come from profiles (full_name). People who have gone silent (closed tab, no
-- connection) are not listed, so the lobby and the "n of 4" count show who is really there.
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
        (p_profile = r.host_id and m.status in ('waiting', 'admitted')
           and m.last_seen_at > now() - public.video_room_seat_timeout())
        or (v_mine = 'admitted' and m.status = 'admitted'
           and m.last_seen_at > now() - public.video_room_seat_timeout())
        or m.profile_id = p_profile
      )
    order by (m.profile_id = r.host_id) desc, m.joined_at;
end $$;

-- A tutor's own open rooms (not session rooms), newest first, so a link that was lost can be found again and the
-- limit of 5 open rooms can be worked with. in_room: how many are in the call now.
create or replace function public.list_my_video_rooms(p_host uuid)
returns table (
  code text, max_participants integer, relay_only boolean, created_at timestamptz, expires_at timestamptz, in_room integer
)
language sql
stable
security definer
set search_path = public
as $$
  select r.code, r.max_participants, r.relay_only, r.created_at, r.expires_at,
         (select count(*)::integer from public.video_room_members x
          where x.room_id = r.id and x.status = 'admitted'
            and x.last_seen_at > now() - public.video_room_seat_timeout())
  from public.video_rooms r
  where r.host_id = p_host and r.session_id is null and r.ended_at is null and r.expires_at > now()
  order by r.created_at desc;
$$;

-- Clean-up: rooms ended or expired more than 30 days ago. Scheduled daily at the foot of this file (data-deletion plan,
-- row 15: nothing else removes old rooms and who was in them).
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
  public.video_room_seat_timeout(),
  public.video_room_guests_seated(uuid, uuid),
  public.create_video_room(uuid, text, integer, boolean),
  public.video_room_enter(uuid, uuid, uuid),
  public.join_video_room(text, uuid, uuid),
  public.open_video_session_room(uuid, uuid, text, boolean),
  public.admit_video_room_member(uuid, uuid, uuid),
  public.remove_video_room_member(uuid, uuid, uuid),
  public.leave_video_room(uuid, uuid, uuid),
  public.heartbeat_video_room(uuid, uuid, uuid),
  public.end_video_room(uuid, uuid),
  public.video_room_state(uuid, uuid),
  public.list_my_video_rooms(uuid),
  public.purge_old_video_rooms()
from public, anon, authenticated;
grant execute on function
  public.video_room_seat_timeout(),
  public.video_room_guests_seated(uuid, uuid),
  public.create_video_room(uuid, text, integer, boolean),
  public.video_room_enter(uuid, uuid, uuid),
  public.join_video_room(text, uuid, uuid),
  public.open_video_session_room(uuid, uuid, text, boolean),
  public.admit_video_room_member(uuid, uuid, uuid),
  public.remove_video_room_member(uuid, uuid, uuid),
  public.leave_video_room(uuid, uuid, uuid),
  public.heartbeat_video_room(uuid, uuid, uuid),
  public.end_video_room(uuid, uuid),
  public.video_room_state(uuid, uuid),
  public.list_my_video_rooms(uuid),
  public.purge_old_video_rooms()
to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Daily clean-up of old rooms (03:17 UTC, a quiet hour). Same pattern as the other jobs in this project.
-- ---------------------------------------------------------------------------------------------------------
select cron.unschedule('purge-old-video-rooms') where exists (select 1 from cron.job where jobname = 'purge-old-video-rooms');
select cron.schedule('purge-old-video-rooms', '17 3 * * *', 'select public.purge_old_video_rooms();');
