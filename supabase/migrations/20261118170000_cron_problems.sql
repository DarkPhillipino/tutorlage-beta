-- 18 Nov 2026, SHOULD batch A item 18: an admin alert when a scheduled job (pg_cron) fails silently. Purely ADDITIVE: ONE new read-only function. No table, job, setting, policy or existing function is changed.
-- Today nothing tells a person when a job stops: a failed run is only a row in cron.job_run_details, and a job that has stopped running leaves no row at all. 20 jobs run on production
-- (refunds, closing accounts, retention, the wallet backstop, ...), so this is the "silent failure" the 17 Nov review asked to watch.
--
-- admin_cron_problems(p_hours default 24): super admins only (it shows internal error text). One row per problem, for ACTIVE jobs only:
--   problem 'failed'  : the job had at least one run with status 'failed' in the last p_hours (failures = how many, message = the newest error, cut to 200 characters);
--   problem 'stalled' : the job has run before but its newest run is older than two of its own intervals plus 10 minutes (only for schedules the function can read:
--                       "*/N * * * *" = every N minutes, and "M H * * *" = once a day; any other schedule is not judged as stalled).
-- ref is a stable text handle for the alert ("<job>:failed:<newest failed run id>" or "<job>:stalled:<last run time>"), so the admin app tells a new problem from one already seen.
-- It reads cron.job and cron.job_run_details only and names no person. A job that never ran is not flagged (a new job would be, for its first minutes).
-- The function reads the scheduler's tables through two tiny internal wrappers (cron_problem_jobs, cron_problem_runs; nobody can call them) so the rolled-back test can swap them for
-- made-up rows: the test role may not write to the scheduler's own tables.
-- Rollback: Drake/programmer/rollbacks/20261118170000_cron_problems_ROLLBACK.sql

create or replace function public.cron_problem_jobs()
returns table (jobid bigint, jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.jobid, b.jobname::text, b.schedule::text, b.active from cron.job b;
$$;
revoke all on function public.cron_problem_jobs() from public, anon, authenticated, service_role;

create or replace function public.cron_problem_runs()
returns table (jobid bigint, runid bigint, status text, return_message text, start_time timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.jobid, d.runid, d.status::text, d.return_message::text, d.start_time from cron.job_run_details d;
$$;
revoke all on function public.cron_problem_runs() from public, anon, authenticated, service_role;

create or replace function public.admin_cron_problems(p_hours integer default 24)
returns table (
  job_name text,
  problem text,
  failures bigint,
  last_status text,
  last_run_at timestamptz,
  message text,
  ref text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can see this' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'Hours must be between 1 and 720' using errcode = '22023';
  end if;
  return query
  with j as (
    select b.jobid, b.jobname as jname, b.schedule as sched,
           case when b.schedule ~ '^\*/[0-9]+ \* \* \* \*$' then substring(b.schedule from '^\*/([0-9]+)')::int
                when b.schedule ~ '^[0-9]+ [0-9]+ \* \* \*$' then 1440
                else null end as every_min
      from public.cron_problem_jobs() b where b.active
  ),
  newest as (
    select distinct on (d.jobid) d.jobid, d.status as st, d.start_time as t
      from public.cron_problem_runs() d where d.jobid in (select jobid from j)
     order by d.jobid, d.start_time desc
  ),
  fails as (
    select d.jobid, count(*) as n, max(d.runid) as last_runid,
           (array_agg(left(coalesce(d.return_message, ''), 200) order by d.start_time desc))[1] as msg
      from public.cron_problem_runs() d
     where d.status = 'failed' and d.start_time >= now() - make_interval(hours => p_hours) and d.jobid in (select jobid from j)
     group by d.jobid
  )
  select j.jname, 'failed'::text, f.n, nw.st, nw.t, f.msg, j.jname || ':failed:' || f.last_runid::text
    from j join fails f on f.jobid = j.jobid left join newest nw on nw.jobid = j.jobid
  union all
  select j.jname, 'stalled'::text, 0::bigint, nw.st, nw.t, ('Last ran ' || to_char(nw.t at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') || ' SAST; it should run about every ' || j.every_min || ' minutes')::text,
         j.jname || ':stalled:' || to_char(nw.t at time zone 'UTC', 'YYYYMMDDHH24MI')
    from j join newest nw on nw.jobid = j.jobid
   where j.every_min is not null and nw.t < now() - make_interval(mins => 2 * j.every_min + 10)
  order by 1, 2;
end;
$$;
revoke all on function public.admin_cron_problems(integer) from public, anon, service_role;
grant execute on function public.admin_cron_problems(integer) to authenticated;
