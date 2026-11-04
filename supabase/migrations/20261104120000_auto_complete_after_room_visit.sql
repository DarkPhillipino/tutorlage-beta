-- 2026-11-04 (CEO: "do (c)"). A tutor was not paid after a short test lesson in the session's video room: leaving the room does not
-- complete the session, the tutor can mark it complete only once its scheduled time has ended, and otherwise the job
-- auto_complete_sessions() completes it 48 hours after the scheduled end (setting session_auto_complete_hours).
--
-- Now a session whose OWN video room was used by BOTH its tutor and at least one other person (the learner, or a parent or guardian:
-- each was admitted to the room at some point) completes automatically a short time after its scheduled end instead of 48 hours later.
-- That short time is a setting, session_auto_complete_hours_after_room (default 2), and it can never be longer than the 48-hour setting.
-- Everything else about auto-completion is exactly as before:
--   * it still never happens before the scheduled end, and never while a problem report on the session is open or under investigation;
--   * a session with no room visit, or a room used by the tutor alone, still waits the full session_auto_complete_hours;
--   * completing a session still fires the same trigger that credits the tutor's wallet (nothing about the money changes).
-- One object is replaced: public.auto_complete_sessions() (same name, same signature, same privileges, same 15-minute cron job). One setting
-- is added. No table, trigger or policy changes.

insert into public.system_settings (setting_key, setting_value, description) values
  ('session_auto_complete_hours_after_room', '2'::jsonb,
   'Hours after a session''s scheduled end before it completes automatically, when its video room was used by the tutor and at least one other person, unless a problem report is open. Never longer than session_auto_complete_hours (CEO, 2026-11-04).')
on conflict (setting_key) do nothing;

create or replace function public.auto_complete_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours integer;
  v_room_hours integer;
  s record;
  n integer := 0;
begin
  select coalesce((select (setting_value #>> '{}')::integer from public.system_settings
                   where setting_key = 'session_auto_complete_hours'), 48)
  into v_hours;
  select coalesce((select (setting_value #>> '{}')::integer from public.system_settings
                   where setting_key = 'session_auto_complete_hours_after_room'), 2)
  into v_room_hours;
  -- The short wait is only ever shorter.
  v_room_hours := least(v_room_hours, v_hours);

  for s in
    select se.id, se.student_id, se.tutor_id, se.booked_by_profile_id,
           case when u.used_room then v_room_hours else v_hours end as delay_hours,
           u.used_room
    from public.sessions se
    cross join lateral (
      -- Used by both: the tutor and at least one other person were admitted to this session's room.
      select exists (
        select 1
        from public.video_rooms vr
        where vr.session_id = se.id
          and exists (select 1 from public.video_room_members tm
                      where tm.room_id = vr.id and tm.profile_id = se.tutor_id and tm.admitted_at is not null)
          and exists (select 1 from public.video_room_members om
                      where om.room_id = vr.id and om.profile_id <> se.tutor_id and om.admitted_at is not null)
      ) as used_room
    ) u
    where se.status = 'scheduled'
      and se.scheduled_start + make_interval(mins => (se.duration_hours * 60)::int)
          + make_interval(hours => case when u.used_room then v_room_hours else v_hours end) < now()
      and not exists (
        select 1 from public.platform_disputes d
        where d.session_id = se.id and d.status in ('open', 'under_investigation')
      )
    for update of se skip locked
  loop
    update public.sessions set status = 'completed', completed_at = now() where id = s.id;
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    values
      (s.student_id, 'session_completed', 'How was your session?',
       'This session was marked complete automatically, ' || s.delay_hours || ' hours after it ended. Rate it to help other learners.', s.id),
      (s.tutor_id, 'session_completed', 'Session marked complete',
       'A session was marked complete automatically, ' || s.delay_hours || ' hours after it ended.', s.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.auto_complete_sessions() from public, anon, authenticated;
