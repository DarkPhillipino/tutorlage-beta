-- 2026-11-23, P4-6: the nightly "no longer ready" check (PM line 42, job B; design in the step-1 report). ADDITIVE: one new table, three new functions, one new job. Nothing existing is changed.
-- Why: a tutor is approved on the rules of the day; nothing looked at them AFTER (step 1 found V1's police certificate aged out five days after approval, V4's documents rejected after approval).
-- What it does: every night (00:10 SAST) tutor_drift_scan() looks at every VERIFIED tutor and records what has drifted, in tutor_drift_findings (one open row per tutor and kind; a finding that
-- stops being true is closed, not deleted, so the history stays). Kinds:
--   not_ready                  tutor_readiness() says the tutor would not be approved today (detail: the reason codes);
--   floor_without_credential   a credential floor is set but no verified, in-date credential gives it (the level would be unexplained);
--   level_unexplained          the level is higher than both what the six criteria earn and the credential floor (only a manual edit can cause it);
--   subject_rule_not_met       the tutor has an approved subject but Module 7 and the code of conduct are neither done nor exempted (subject_approval_blocker).
-- NOTHING IS SUSPENDED and nobody is told anything automatically: the alert is the admin app's watcher asking admin_tutor_drift() (read only, verification officer or super admin), which
-- answers one row per open finding with a ref that is new only when the finding is new. Names nobody (a tutor id only; the admin app shows the name it already shows).
-- Rollback: drop the job, the three functions and the table (Drake/programmer/rollbacks/20261123120000_p4_drift_check_ROLLBACK.sql). Test: supabase/tests/p4_drift_check.sql.

create table if not exists public.tutor_drift_findings (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  kind text not null check (kind in ('not_ready', 'floor_without_credential', 'level_unexplained', 'subject_rule_not_met')),
  detail jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists tutor_drift_open_uidx on public.tutor_drift_findings (tutor_id, kind) where resolved_at is null;
create index if not exists tutor_drift_tutor_idx on public.tutor_drift_findings (tutor_id);
alter table public.tutor_drift_findings enable row level security;
revoke all on table public.tutor_drift_findings from public, anon, authenticated, service_role;

-- The scan: the owner (the nightly job) only. Returns the number of findings that are open afterwards.
create or replace function public.tutor_drift_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  t record;
  v_ready jsonb;
  v_earned_rate numeric;
  v_floor_rate numeric;
  v_cur_rate numeric;
  v_hours numeric;
  v_n integer;
begin
  create temporary table if not exists pg_temp.drift_now (tutor_id uuid, kind text, detail jsonb) on commit drop;
  delete from pg_temp.drift_now;
  for t in select tp.* from public.tutor_profiles tp where tp.is_verified loop
    v_ready := public.tutor_readiness(t.id);
    if not (v_ready ->> 'ready')::boolean then
      insert into pg_temp.drift_now values (t.id, 'not_ready', jsonb_build_object('reasons', v_ready -> 'reasons'));
    end if;

    -- the credential floor needs a verified, in-date credential that gives it
    if t.credential_floor_sub_tier_id is not null and not exists (
      select 1 from public.tutor_credentials c
      join public.credential_definitions d on d.code = c.credential_code
      where c.tutor_id = t.id and c.status = 'verified'
        and coalesce(c.assigned_sub_tier_id, d.entry_sub_tier_id) = t.credential_floor_sub_tier_id
        and (d.recency_years is null or c.obtained_on is null or c.obtained_on >= (v_today - make_interval(years => d.recency_years))::date)
    ) then
      insert into pg_temp.drift_now values (t.id, 'floor_without_credential', jsonb_build_object('floor', t.credential_floor_sub_tier_id));
    end if;

    -- the level against what the rules give (the same six criteria as fn_recalculate_tutor_tier, read only)
    select coalesce(sum(hours), 0) into v_hours from public.tutor_prior_hours where tutor_id = t.id and removed_at is null;
    select max(s.max_allowed_rate) into v_earned_rate from public.sub_tier_definitions s
     where s.min_hours <= coalesce(t.total_completed_hours, 0) + v_hours and s.min_rating <= coalesce(t.avg_rating, 0)
       and s.min_repeat_rate_pct <= coalesce(t.repeat_student_rate_pct, 0) and s.min_written_reviews <= coalesce(t.total_reviews_count, 0)
       and s.min_distinct_students_uplift <= coalesce(t.qualified_uplift_students_count, 0) and s.required_grade_uplift_pct <= coalesce(t.avg_grade_uplift_pct, 0);
    select max_allowed_rate into v_floor_rate from public.sub_tier_definitions where id = t.credential_floor_sub_tier_id;
    select max_allowed_rate into v_cur_rate from public.sub_tier_definitions where id = t.current_sub_tier_id;
    if v_cur_rate is not null and v_cur_rate > greatest(coalesce(v_earned_rate, 0), coalesce(v_floor_rate, 0)) and not coalesce(t.tier_frozen, false) then
      insert into pg_temp.drift_now values (t.id, 'level_unexplained', jsonb_build_object('level', t.current_sub_tier_id));
    end if;

    if exists (select 1 from public.tutor_subject_competencies c where c.tutor_id = t.id and c.verification_status::text = 'verified')
       and public.subject_approval_blocker(t.id) is not null then
      insert into pg_temp.drift_now values (t.id, 'subject_rule_not_met', jsonb_build_object('subjects',
        (select count(*) from public.tutor_subject_competencies c where c.tutor_id = t.id and c.verification_status::text = 'verified')));
    end if;
  end loop;

  -- open what is new, refresh what is still true, close what is no longer true
  insert into public.tutor_drift_findings (tutor_id, kind, detail)
  select n.tutor_id, n.kind, n.detail from pg_temp.drift_now n
  on conflict (tutor_id, kind) where resolved_at is null do update set detail = excluded.detail, last_seen = now();
  update public.tutor_drift_findings f set resolved_at = now()
   where f.resolved_at is null and not exists (select 1 from pg_temp.drift_now n where n.tutor_id = f.tutor_id and n.kind = f.kind);
  select count(*) into v_n from public.tutor_drift_findings where resolved_at is null;
  return v_n;
end;
$$;
revoke all on function public.tutor_drift_scan() from public, anon, authenticated, service_role;

-- The read: one row per open finding. Verification officer or super admin only; read only.
create or replace function public.admin_tutor_drift()
returns table (tutor_id uuid, kind text, detail jsonb, first_seen timestamptz, last_seen timestamptz, ref text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can see this' using errcode = '42501';
  end if;
  return query
    select f.tutor_id, f.kind, f.detail, f.first_seen, f.last_seen,
           'drift:' || f.tutor_id::text || ':' || f.kind || ':' || to_char(f.first_seen at time zone 'UTC', 'YYYYMMDD')
      from public.tutor_drift_findings f
     where f.resolved_at is null
     order by f.first_seen, f.kind;
end;
$$;
revoke all on function public.admin_tutor_drift() from public, anon, service_role;
grant execute on function public.admin_tutor_drift() to authenticated;

-- The nightly job: 22:10 UTC = 00:10 SAST. (A database without pg_cron refuses, as the other scheduled migrations do.)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed, so the nightly drift check cannot be scheduled';
  end if;
  perform cron.unschedule('tutor-drift-scan') where exists (select 1 from cron.job where jobname = 'tutor-drift-scan');
  perform cron.schedule('tutor-drift-scan', '10 22 * * *', 'select public.tutor_drift_scan();');
end;
$$;
