-- JOB WEEKLY (PM line 62, 24 Nov 2026): a weekly progress card from a tutor's REAL numbers, and a Monday in-app notice "Your weekly post is ready: tap to share".
--   NEW function public.my_weekly_post()          signed in; a tutor whose page is ON: {week, lessons}. `lessons` = her lessons COMPLETED in the last 7 days (status completed only; never scheduled).
--                                                  `week` = 1 on the day her page went live (tutor_public_profile.basis_at, South African date) and 1 more every 7 days. Counts only: no learner, no family, no money.
--                                                  Anyone else (not a tutor, page off, not verified): null.
--   NEW function public.send_weekly_post_notices() (internal, nobody can call it from the app) one bell notice per tutor whose page is ON and who is verified; none for a tutor whose page is
--                                                  off; at most one per tutor per 6 days (so a re-run does not double it). Type `weekly_post_ready`.
--   NEW scheduled job `weekly-post-notice`          Monday 08:00 South African time = 06:00 UTC ('0 6 * * 1').
-- UNDO: select cron.unschedule('weekly-post-notice'); drop function public.send_weekly_post_notices(); drop function public.my_weekly_post();

create or replace function public.my_weekly_post()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_week integer;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select x.basis_at into v_start
    from public.tutor_public_profile x
    join public.tutor_profiles tp on tp.id = x.tutor_id and tp.is_verified
   where x.tutor_id = auth.uid() and x.is_public;
  if not found then return null; end if;
  v_week := 1 + greatest(0, ((now() at time zone 'Africa/Johannesburg')::date - (coalesce(v_start, now()) at time zone 'Africa/Johannesburg')::date)) / 7;
  select count(*)::integer into v_n from public.sessions s
   where s.tutor_id = auth.uid() and s.status = 'completed'
     and coalesce(s.completed_at, s.scheduled_start) >= now() - interval '7 days' and coalesce(s.completed_at, s.scheduled_start) <= now();
  return jsonb_build_object('week', v_week, 'lessons', v_n);
end;
$$;
revoke all on function public.my_weekly_post() from public, anon;
grant execute on function public.my_weekly_post() to authenticated;

create or replace function public.send_weekly_post_notices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with t as (
    select x.tutor_id from public.tutor_public_profile x
      join public.tutor_profiles tp on tp.id = x.tutor_id and tp.is_verified
     where x.is_public
       and not exists (select 1 from public.notifications n where n.profile_id = x.tutor_id and n.type = 'weekly_post_ready' and n.created_at > now() - interval '6 days')
  ), ins as (
    insert into public.notifications (profile_id, type, title, body)
    select t.tutor_id, 'weekly_post_ready', 'Your weekly post is ready', 'Your weekly post is ready: tap to share.' from t
    returning 1
  )
  select count(*)::integer into v_n from ins;
  return v_n;
end;
$$;
revoke all on function public.send_weekly_post_notices() from public, anon, authenticated;

select cron.schedule('weekly-post-notice', '0 6 * * 1', 'select public.send_weekly_post_notices();');
