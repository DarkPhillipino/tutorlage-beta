-- The tutor's "You have an upcoming session" bell notice now names the zone of the time it gives (CEO, 1 Nov 2026: "Session times name
-- the zone"; release gate row SA-LOCALE-01). It already wrote the time in South African time; the words did not say so, so "Session with
-- Aisha (Maths), Fri 20 Nov 14:00." read as the reader's own clock. Now: "Session with Aisha (Maths), Fri 20 Nov 14:00 SAST. Open Sessions ...".
--
-- What this changes (nothing else): ONE function is replaced with the same body plus the three letters. Notices already written keep the
-- words they were written with; no row is touched. The trigger, its grants and its firing rule are exactly as in
-- 20261017224500_tutor_session_booked_notice.sql. Safe to apply at any time and safe to leave unapplied (the app does not depend on it).
-- Test: supabase/tests/tutor_session_booked_notice.sql (B1 now also wants " SAST." after the time).

create or replace function public.notify_tutor_session_booked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learner text;
  v_subject text;
  v_when text;
begin
  select split_part(trim(full_name), ' ', 1) into v_learner from public.profiles where id = new.student_id;
  select subject_name into v_subject from public.student_subject_enrollments where id = new.enrollment_id;
  v_when := to_char(new.scheduled_start at time zone 'Africa/Johannesburg', 'FMDy FMDD FMMon HH24:MI') || ' SAST';
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (
    new.tutor_id,
    'session_booked',
    'You have an upcoming session',
    format('Session with %s%s, %s. Open Sessions to start the video call when it is time.',
           coalesce(nullif(v_learner, ''), 'your learner'),
           case when v_subject is null then '' else ' (' || v_subject || ')' end,
           v_when),
    new.id
  );
  return new;
end;
$$;
revoke all on function public.notify_tutor_session_booked() from public, anon, authenticated;
