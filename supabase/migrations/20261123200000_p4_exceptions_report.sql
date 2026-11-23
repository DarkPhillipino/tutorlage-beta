-- 2026-11-23, P4-5 (PM line 46, job N): THE EXCEPTIONS REPORT. ONE read-only function that lists, in one place, everything that bypasses the rules by a person's decision (or has drifted since): a level set directly,
-- hours taught elsewhere, a Module 7 exemption, and an approved tutor who is no longer ready. Nobody saw these together before (step 1, slip 6: "exceptions are quiet").
-- ADDITIVE: one new function, nothing changed. Read only. Verification officer and super admin. Returns counts and up to 100 rows, newest first; each row has a tutor id (the screen shows the name it already shows)
-- and a reason or reason codes, the date, and where it applies an end date. It quotes no document and no personal detail beyond the name on the profile the officer already reads.
--   direct_level   an 'admin_assigned' credential (the level set by hand, with the reason that was typed)
--   prior_hours    an un-removed entry of hours taught outside Tutorlage (hours, reason, proof reference)
--   module7        an exemption from Module 7 that has not ended (until when, reason)
--   not_ready      an open finding of the nightly check (P4-6): the reason codes
-- Rollback: Drake/programmer/rollbacks/20261123200000_p4_exceptions_report_ROLLBACK.sql. Test: supabase/tests/p4_exceptions_report.sql.

create or replace function public.admin_exceptions_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_counts jsonb;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can see this' using errcode = '42501'; end if;

  with ex as (
    select 'direct_level'::text as kind, c.tutor_id, coalesce(nullif(btrim(p.full_name), ''), 'Tutor') as name, c.note as reason, ('level ' || coalesce(c.assigned_sub_tier_id, '?'))::text as detail,
           coalesce(c.verified_at, c.created_at) as since, null::timestamptz as ends_at
      from public.tutor_credentials c left join public.profiles p on p.id = c.tutor_id where c.credential_code = 'admin_assigned'
    union all
    select 'prior_hours', h.tutor_id, coalesce(nullif(btrim(p.full_name), ''), 'Tutor'), h.reason, (h.hours::text || ' hours; proof: ' || h.proof_reference), h.added_at, null
      from public.tutor_prior_hours h left join public.profiles p on p.id = h.tutor_id where h.removed_at is null
    union all
    select 'module7', e.tutor_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(f.full_name), ''), 'Person on the list'), e.reason,
           (case when e.tutor_id is null then 'before sign-up (list row)' else 'account' end), e.granted_at, e.ends_at
      from public.module7_exemptions e left join public.profiles p on p.id = e.tutor_id left join public.founding_tutors_list f on f.id = e.list_row_id where e.ends_at > now()
    union all
    select 'not_ready', f.tutor_id, coalesce(nullif(btrim(p.full_name), ''), 'Tutor'), null, (f.kind || ': ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(f.detail -> 'reasons') x), f.detail::text)),
           f.first_seen, null
      from public.tutor_drift_findings f left join public.profiles p on p.id = f.tutor_id where f.resolved_at is null
  )
  select jsonb_build_object('direct_level', count(*) filter (where kind = 'direct_level'), 'prior_hours', count(*) filter (where kind = 'prior_hours'),
                            'module7', count(*) filter (where kind = 'module7'), 'not_ready', count(*) filter (where kind = 'not_ready'),
                            'grandfathered', (select count(*) from public.tutor_onboarding where grandfathered)),
         coalesce((select jsonb_agg(jsonb_build_object('kind', y.kind, 'tutor_id', y.tutor_id, 'name', y.name, 'reason', y.reason, 'detail', y.detail, 'since', y.since, 'ends_at', y.ends_at) order by y.since desc)
                     from (select * from ex order by since desc limit 100) y), '[]'::jsonb)
    into v_counts, v_rows from ex;
  return jsonb_build_object('counts', v_counts, 'rows', v_rows);
end;
$$;
revoke all on function public.admin_exceptions_report() from public, anon, service_role;
grant execute on function public.admin_exceptions_report() to authenticated;
