-- 2026-11-21 (PM line 13, J1 of Start brief 3): the in-app notice "Your tutor has not joined yet". Additive only: one column, two settings, one function, one job.
--
-- Rule: ONE notice per session start, to the learner and, if different, to the person who booked it (the paying parent), when
--   * the session is still 'scheduled' (not cancelled, not completed),
--   * its scheduled start passed at least N minutes ago (setting tutor_not_joined_minutes, default 5, kept between 1 and 120),
--   * its scheduled end has NOT passed (no late notice for a session that is over),
--   * the session has no meeting link of its own (a tutor who uses an outside link is never in OUR room, so we cannot see them: no notice), and
--   * the tutor was never admitted to the session's own video room (video_room_members.admitted_at is the same "joined" signal that
--     auto_complete_sessions() uses). A session with no room row at all counts as "tutor not joined".
-- Switch: notice_tutor_not_joined, OFF by default: while it is off the job writes nothing. The email half is the existing
-- notice_email_tutor_not_joined (migration 20261118220000), which mails a notification of type 'tutor_not_joined'; no mail code changes.
-- Once only: sessions.tutor_not_joined_notified_start holds the scheduled_start the notice was written for; a session is picked up only
-- while that is null or different from its scheduled_start (so a session moved to a new time can be told once for the new time).
-- Words (PM-written, exact): title 'Your tutor has not joined yet'; body 'Your tutor has not joined your session yet. Please stay on the session page: you can join as soon as they arrive.'

alter table public.sessions add column if not exists tutor_not_joined_notified_start timestamptz;

insert into public.system_settings (setting_key, setting_value, description) values
  ('notice_tutor_not_joined', 'false'::jsonb,
   'Write the in-app notice "Your tutor has not joined yet" to the learner (and the booking parent) when the tutor has not joined the session''s video room a few minutes after the start. OFF until the PM/CEO switches it on.'),
  ('tutor_not_joined_minutes', '5'::jsonb,
   'Minutes after a session''s scheduled start before the "tutor has not joined" notice is written (1 to 120; anything else counts as 5).')
on conflict (setting_key) do nothing;

create or replace function public.notify_tutor_not_joined()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'notice_tutor_not_joined'), false);
  v_raw text := (select s.setting_value #>> '{}' from public.system_settings s where s.setting_key = 'tutor_not_joined_minutes');
  v_min integer;
  s record;
  n integer := 0;
begin
  if not v_on then
    return 0;
  end if;
  v_min := case when v_raw ~ '^[0-9]{1,3}$' and v_raw::integer between 1 and 120 then v_raw::integer else 5 end;

  for s in
    select se.id, se.student_id, se.booked_by_profile_id, se.scheduled_start
    from public.sessions se
    where se.status = 'scheduled'
      and se.meeting_url is null
      and se.tutor_not_joined_notified_start is distinct from se.scheduled_start
      and se.scheduled_start <= now() - make_interval(mins => v_min)
      and now() < se.scheduled_start + make_interval(mins => (se.duration_hours * 60)::int)
      and not exists (
        select 1
        from public.video_rooms vr
        join public.video_room_members tm on tm.room_id = vr.id
        where vr.session_id = se.id and tm.profile_id = se.tutor_id and tm.admitted_at is not null
      )
    for update of se skip locked
  loop
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    select x.p, 'tutor_not_joined', 'Your tutor has not joined yet',
           'Your tutor has not joined your session yet. Please stay on the session page: you can join as soon as they arrive.', s.id
    from (select s.student_id as p union select s.booked_by_profile_id where s.booked_by_profile_id is not null) x;
    update public.sessions set tutor_not_joined_notified_start = s.scheduled_start where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.notify_tutor_not_joined() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('notify-tutor-not-joined') where exists (select 1 from cron.job where jobname = 'notify-tutor-not-joined');
    perform cron.schedule('notify-tutor-not-joined', '*/2 * * * *', 'select public.notify_tutor_not_joined();');
  end if;
end $$;
