-- 16 Oct 2026 (found in the CEO's own test, from the parent's side of a booking): when a tutor saves the link to join a
-- session, the notification "Your session link is ready" was written ONLY for the learner (sessions.student_id). A parent who booked
-- the session for their child (sessions.booked_by_profile_id) was never told, so their bell stayed silent and they did not know
-- the link was there. Every other session notice ("A tutor accepted your request", cancelled, expired) already reaches both.
--
-- WHAT THIS REPLACES (one function, listed before it is applied):
--   function set_session_meeting_link(uuid, text): the same checks and the same update as before (only this session's tutor; only
--   an upcoming session; a full https:// link of 12 to 500 characters); the only change is who is told: the learner AND the person
--   who booked the session, once each (the same person is not told twice when a learner booked for themselves).
-- NOT touched: any table, policy, trigger, payment or other function.

create or replace function public.set_session_meeting_link(p_session_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session record;
begin
  select tutor_id, student_id, booked_by_profile_id, status into v_session from public.sessions where id = p_session_id for update;
  if not found or v_session.tutor_id is distinct from auth.uid() then
    raise exception 'Only this session''s tutor can set its link' using errcode = '42501';
  end if;
  if v_session.status not in ('scheduled', 'pending_confirmation') then
    raise exception 'This session isn''t upcoming any more';
  end if;
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' or length(p_url) not between 12 and 500 then
    raise exception 'Enter the full meeting link, starting with https://';
  end if;
  update public.sessions set meeting_url = p_url where id = p_session_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select distinct p, 'session_link', 'Your session link is ready',
         'Your tutor added the link to join your session.', p_session_id
  from unnest(array[v_session.student_id, v_session.booked_by_profile_id]) as p
  where p is not null;
end;
$function$;
