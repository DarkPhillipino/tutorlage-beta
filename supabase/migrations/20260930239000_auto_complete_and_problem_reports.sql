-- 2026-09-30 (fourth session). Master backlog 7u, plus the dispute path it depends on.
--
-- 1. Auto-completion. Only the tutor could mark a session complete, and completion is the revenue
--    trigger for the R16M goal (accounting), the learner's cue to rate, and what runs tier
--    progression. Now a job completes a scheduled session automatically **48 hours after its
--    scheduled end** (the CEO's answer on 2026-09-30, fourth session: "48 hours (Recommended)"),
--    unless a problem report about it is still open. The delay is a setting
--    (session_auto_complete_hours), not a constant.
--
-- 2. Reporting a problem. "Unless disputed" meant nothing: the app had no way for a learner to raise
--    a dispute, and the table's own rules were loose — any signed-in user could insert a dispute row
--    for ANY session (the INSERT policy only checked raised_by_id = auth.uid()), and could set its
--    status, refund amount, assigned admin and resolution notes on the way in. That would also let a
--    stranger hold up someone else's auto-completion. Now the only client path is
--    report_session_problem(): the caller must be the session's learner, the person who booked it, or
--    its tutor; the report starts 'open' with nothing pre-filled; one open report per person per
--    session; within 14 days of the session's end. Admins are notified. Admins still resolve disputes
--    from admin/ exactly as before (their UPDATE policy is untouched).

insert into public.system_settings (setting_key, setting_value, description) values
  ('session_auto_complete_hours', '48'::jsonb,
   'Hours after a session''s scheduled end before it completes automatically, unless a problem report is open (CEO, 2026-09-30).')
on conflict (setting_key) do nothing;

create or replace function public.auto_complete_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours integer;
  s record;
  n integer := 0;
begin
  select coalesce((select (setting_value #>> '{}')::integer from public.system_settings
                   where setting_key = 'session_auto_complete_hours'), 48)
  into v_hours;

  for s in
    select se.id, se.student_id, se.tutor_id, se.booked_by_profile_id
    from public.sessions se
    where se.status = 'scheduled'
      and se.scheduled_start + make_interval(mins => (se.duration_hours * 60)::int) + make_interval(hours => v_hours) < now()
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
       'This session was marked complete automatically, ' || v_hours || ' hours after it ended. Rate it to help other learners.', s.id),
      (s.tutor_id, 'session_completed', 'Session marked complete',
       'A session was marked complete automatically, ' || v_hours || ' hours after it ended.', s.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.auto_complete_sessions() from public, anon, authenticated;

select cron.unschedule('auto-complete-sessions') where exists (select 1 from cron.job where jobname = 'auto-complete-sessions');
select cron.schedule('auto-complete-sessions', '*/15 * * * *', 'select public.auto_complete_sessions();');

-- Problem reports ---------------------------------------------------------------------------------
drop policy if exists "Users can create disputes" on public.platform_disputes;
revoke insert on public.platform_disputes from anon, authenticated;
alter policy "Users can view own disputes" on public.platform_disputes to authenticated;

create or replace function public.report_session_problem(p_session_id uuid, p_reason public.dispute_reason, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session record;
  v_description text := trim(coalesce(p_description, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select id, student_id, tutor_id, booked_by_profile_id, status, scheduled_start, duration_hours, currency_code
  into v_session
  from public.sessions where id = p_session_id;
  if not found or v_uid not in (v_session.student_id, v_session.tutor_id, coalesce(v_session.booked_by_profile_id, v_session.student_id)) then
    raise exception 'You can only report a problem with your own session' using errcode = '42501';
  end if;
  if v_session.status not in ('scheduled', 'completed') then
    raise exception 'This session was cancelled — contact support if something is still wrong';
  end if;
  if now() > v_session.scheduled_start + make_interval(mins => (v_session.duration_hours * 60)::int) + interval '14 days' then
    raise exception 'Problems have to be reported within 14 days of the session — contact support';
  end if;
  if length(v_description) < 10 or length(v_description) > 2000 then
    raise exception 'Describe the problem in a sentence or two (10 to 2000 characters)';
  end if;
  if exists (select 1 from public.platform_disputes
             where session_id = p_session_id and raised_by_id = v_uid and status in ('open', 'under_investigation')) then
    raise exception 'You already have an open report for this session — we''ll be in touch';
  end if;

  insert into public.platform_disputes (session_id, raised_by_id, reason, description, currency_code)
  values (p_session_id, v_uid, p_reason, v_description, v_session.currency_code)
  returning id into v_id;

  perform public.notify_active_admins('dispute_opened', 'A problem was reported',
    'A ' || replace(p_reason::text, '_', ' ') || ' report was raised on a session. Open Disputes in the admin app.',
    p_session_id);
  return v_id;
end;
$$;
revoke all on function public.report_session_problem(uuid, public.dispute_reason, text) from public, anon;
grant execute on function public.report_session_problem(uuid, public.dispute_reason, text) to authenticated;
