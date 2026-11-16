-- 2026-11-15 (CEO): a session that ends early. Two plain rules, both written for the one real product.
--   1. "Ends early" = the session's TUTOR leaves the session's own video room (the page's leave, or closing the page) BEFORE the scheduled
--      end, after the room was used by the tutor and at least one other person (the learner or a parent/guardian was admitted). A session
--      room cannot be ended by one person (end_video_room refuses it), so the tutor leaving is the only reading that means "the lesson stopped".
--      If the tutor comes back into the room (a reload, a dropped connection) the mark is cleared at once.
--   2. For such a session: the learner / the person who booked it is asked "Is everything alright?" (screen, plus one bell notification
--      about two minutes after the tutor left, if the tutor has not returned), and the tutor is told when Mark complete opens.
-- complete_session already refused before the scheduled end, for every session; the only change there is the plain message for an early end.
-- NO money rule changes: completing still fires the same trigger that credits the tutor (wallet-paid and card-paid), auto_complete_sessions is
-- NOT touched (still never before the scheduled end, never with a problem report open, 2 hours after the end when the room was used, else 48).
-- Tolerant of old site code: new columns are nullable and unread by old code; no existing column, policy or function signature changes.
-- Replaced: public.complete_session(uuid) (message only). New: columns on sessions, trigger on video_room_members, acknowledge_early_end(uuid),
-- notify_early_end_checkins() and its 2-minute job.

alter table public.sessions
  add column if not exists ended_early_at timestamptz,
  add column if not exists early_end_ack_at timestamptz,
  add column if not exists early_end_notified_at timestamptz;

-- The tutor leaves or returns to a session room.
create or replace function public.fn_mark_early_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_tutor uuid;
  v_end timestamptz;
begin
  select r.session_id, se.tutor_id, se.scheduled_start + make_interval(mins => (se.duration_hours * 60)::int)
  into v_session_id, v_tutor, v_end
  from public.video_rooms r
  join public.sessions se on se.id = r.session_id
  where r.id = new.room_id and se.status = 'scheduled';
  if v_session_id is null or new.profile_id is distinct from v_tutor then
    return new;
  end if;
  if new.status = 'admitted' then
    -- Back in the room: not ended after all.
    update public.sessions set ended_early_at = null, early_end_notified_at = null
    where id = v_session_id and ended_early_at is not null;
  elsif new.status = 'left' and now() < v_end
        and (tg_op = 'INSERT' or old.status is distinct from 'left')
        and exists (select 1 from public.video_room_members om
                    where om.room_id = new.room_id and om.profile_id <> v_tutor and om.admitted_at is not null) then
    update public.sessions
    set ended_early_at = now(), early_end_ack_at = null, early_end_notified_at = null
    where id = v_session_id;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_mark_early_end() from public, anon, authenticated;

drop trigger if exists trg_mark_early_end on public.video_room_members;
create trigger trg_mark_early_end
  after insert or update of status on public.video_room_members
  for each row execute function public.fn_mark_early_end();

-- The learner, or whoever booked the session, answers "Yes, all fine".
create or replace function public.acknowledge_early_end(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select student_id, booked_by_profile_id, ended_early_at into v from public.sessions where id = p_session_id for update;
  if not found or auth.uid() is null or auth.uid() not in (v.student_id, coalesce(v.booked_by_profile_id, v.student_id)) then
    raise exception 'Only this session''s learner or the person who booked it can answer' using errcode = '42501';
  end if;
  update public.sessions set early_end_ack_at = now() where id = p_session_id and ended_early_at is not null;
end;
$$;
revoke all on function public.acknowledge_early_end(uuid) from public, anon;
grant execute on function public.acknowledge_early_end(uuid) to authenticated;

-- One bell message per early end, two minutes after the tutor left (a reload is not an early end), unless already answered.
create or replace function public.notify_early_end_checkins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  n integer := 0;
begin
  for s in
    select id, student_id, booked_by_profile_id from public.sessions
    where status = 'scheduled' and ended_early_at is not null and early_end_ack_at is null and early_end_notified_at is null
      and ended_early_at < now() - interval '2 minutes'
      and now() < scheduled_start + make_interval(mins => (duration_hours * 60)::int)
    for update skip locked
  loop
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    select x.p, 'session_check_in', 'Is everything alright?',
           'Your session ended before its scheduled time. Open Sessions to tell us all is fine, or to report a problem.', s.id
    from (select s.student_id as p union select s.booked_by_profile_id where s.booked_by_profile_id is not null) x;
    update public.sessions set early_end_notified_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.notify_early_end_checkins() from public, anon, authenticated;

select cron.unschedule('notify-early-end-checkins') where exists (select 1 from cron.job where jobname = 'notify-early-end-checkins');
select cron.schedule('notify-early-end-checkins', '*/2 * * * *', 'select public.notify_early_end_checkins();');

-- complete_session: identical to 20260930150000 except the plain message when the session ended early.
create or replace function public.complete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_end timestamptz;
begin
  select tutor_id, student_id, status, scheduled_start, duration_hours, ended_early_at into v_session
  from public.sessions where id = p_session_id for update;
  if not found or v_session.tutor_id is distinct from auth.uid() then
    raise exception 'Only this session''s tutor can mark it complete' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'Only a scheduled session can be marked complete';
  end if;
  v_end := v_session.scheduled_start + make_interval(mins => (v_session.duration_hours * 60)::int);
  if now() < v_end then
    if v_session.ended_early_at is not null then
      raise exception 'You ended the session early. You can mark it complete from % (South African time).',
        to_char(v_end at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI');
    end if;
    raise exception 'You can mark a session complete once its scheduled time has ended';
  end if;
  -- trigger_session_completed then runs fn_recalculate_tutor_tier for this tutor.
  update public.sessions set status = 'completed', completed_at = now() where id = p_session_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (v_session.student_id, 'session_completed', 'How was your session?',
          'Your tutor marked the session complete. Rate it to help other learners.', p_session_id);
end;
$$;
revoke all on function public.complete_session(uuid) from public, anon;
grant execute on function public.complete_session(uuid) to authenticated;
