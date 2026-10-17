-- The tutor is told, in the bell, the moment a session is booked (CEO, 17 Oct 2026: "after a tutor accepts a session they dont
-- recieve the upcoming sessions notification ... immediately"). Until now accepting a request told the LEARNER and the parent
-- ("A tutor accepted your request", written by create_session_from_request) and told the tutor nothing, so a tutor who had just
-- accepted had no pointer to where the session was.
--
-- What this adds (nothing is replaced or dropped): one trigger function and one trigger on public.sessions, fired after a session
-- row is inserted, which writes ONE notification for the session's tutor: type 'session_booked', "You have an upcoming session",
-- with the learner's first name, the subject and the time (South African time), related to the session so a tap opens Sessions.
-- It fires on every way a session is made (a tutor accepting, a book-again request, anything inserted later), not only inside
-- create_session_from_request, so it can never drift from it. The learner and the parent keep the notice they already get.
-- Test: supabase/tests/tutor_session_booked_notice.sql.

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
  v_when := to_char(new.scheduled_start at time zone 'Africa/Johannesburg', 'FMDy FMDD FMMon HH24:MI');
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

drop trigger if exists trg_notify_tutor_session_booked on public.sessions;
create trigger trg_notify_tutor_session_booked
  after insert on public.sessions
  for each row execute function public.notify_tutor_session_booked();
