-- Retention jobs (CEO: "yes", 21 Oct 2026; rules: Drake/legal/handover-and-closing-rules-2026-10-21.md B3; design: Drake/programmer/retention-jobs-design-2026-10-21.md).
-- The close-account tool (20261021140000) deletes a closed person's data on day 30 and KEEPS, pseudonymised, what legal says must stay for years.
-- Nothing deleted those kept records when their own clock ran out. This adds one daily job, run_retention_jobs(), that does:
--   * tutor_documents: a tutor's ID copy, police clearance and other verification documents (and their audit lines), the Tier 1 academic records
--     and every stored file of theirs in "tutor-documents", 3 years after they closed (or, only if the CEO turns on the setting
--     retention_quiet_tutor_rule, which ships OFF, stopped tutoring: whichever is first). Files are removed by
--     the Worker through the existing account_closure_tasks queue (kind storage_remove): no second queue. Credentials stay (level numbers).
--   * consent_records: acceptance and consent records (policy_acceptances, guardian_consents, tutor_onboarding, school_results_consents),
--     5 years after the person closed. A row naming two people goes only when BOTH have closed.
--   * problem_reports: resolved or dismissed problem reports (platform_disputes), 5 years after they were resolved.
--   * money_records: payouts, session requests (payments, refunds), sessions and what hangs off them, 7 years after the end of the financial year.
--     Until the accountant names the year-end month the job uses the safe bound: the record's date + 8 years (or + 1 year + the years setting,
--     whichever is later). Only SETTLED money is deleted (allow-lists of final statuses, not deny-lists of unfinished ones).
--   * tombstones: when no kept record for a closed person is left, the closure is finished and the shortest retention period has passed since
--     closing, the tombstone (the only place the name is kept) is destroyed and the names of who asked / how they were checked / the reference in
--     account_closures are blanked (the closing date stays in account_closures.closed_at). The blank profile row stays.
-- A safety hold, an open or under-investigation problem report, a hand-over prepared and not yet delivered, or an admin deferral on ANY person
-- involved in a row stops that row. Every category is journalled: one insert-only row per run per category in retention_deletion_records
-- (counts, how many were past their time but protected, files queued, an error if the category failed; no personal data). A failing category
-- rolls back alone, writes its error and tells the admins; the others still run. So does a failing admin notice or Worker wake-up.
-- Safety rails (review of 28 Oct 2026, EXP-R): the job ships SWITCHED OFF (setting retention_jobs_enabled = false; only the CEO turns it on); the
-- years settings can only lengthen a period (a value below the shipped 3 / 5 / 5 / 7 is ignored); each category deletes at most
-- retention_max_per_run rows per table per run (default 100, never more than 250), which also bounds the advisory locks one run holds; the
-- foreign-key actions and the status names the SQL relies on are CHECKED at run time and a mismatch fails that category (nothing is deleted).
-- Needs (all applied on dev): 20261021100000 (profile_is_on_safety_hold), 20261021130000 (hand_over_events), 20261021140000 (closure_int_setting,
-- closure_has_open_dispute, closure_enqueue_files, closure_wake_worker, account_closures, account_tombstones, account_closure_tasks),
-- 20260930238000 (notify_active_admins), pg_cron (the migration fails loudly without it).
-- Additive: one table, eight setting rows, internal functions, one cron job. Nothing existing is changed; no browser role gets any right.

insert into public.system_settings (setting_key, setting_value, description) values
  ('retention_jobs_enabled', 'false'::jsonb, 'Master switch of the daily retention job. Ships false = OFF: the job runs every night but does nothing. Only the CEO turns it on (set it to true); anything other than true counts as off.'),
  ('retention_max_per_run', '100'::jsonb, 'Most rows the daily retention job deletes per table per run (1 to 250; a bigger backlog is worked off over several nights). Also bounds the locks one run holds.'),
  ('retention_documents_years', '3'::jsonb, 'Years after a tutor closes or stops tutoring before the daily job deletes their ID copy, police clearance, verification documents and Tier 1 academic records. Cannot be set below 3.'),
  ('retention_consent_years', '5'::jsonb, 'Years after a person closes before the daily job deletes their acceptance and consent records. Cannot be set below 5.'),
  ('retention_reports_years', '5'::jsonb, 'Years after a problem report is resolved before the daily job deletes it (never while a matter is open or a person is on a safety hold). Cannot be set below 5.'),
  ('retention_money_years', '7'::jsonb, 'Years after the end of the financial year before the daily job deletes bookings, payments, refunds, payouts and session records. Cannot be set below 7.'),
  ('retention_financial_year_end_month', 'null'::jsonb, 'Month (1 to 12) in which the financial year ends. Empty = not chosen: the daily job then uses the record''s date plus 8 years, never earlier than the real rule.'),
  ('retention_quiet_tutor_rule', 'false'::jsonb, 'Ships OFF; only the CEO turns it on. false = only closing starts the 3-year clock for a tutor''s documents; true = a tutor who never closes but has stopped (not accepting requests, nothing booked, no activity for the whole period) also counts as stopped.')
on conflict (setting_key) do nothing;

-- The journal: one insert-only row per run per category. No API role can read or write it.
-- (admin_notice and worker_wake rows are written only when telling the admins or waking the Worker failed.)
create table if not exists public.retention_deletion_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  category text not null check (category in ('tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'tombstones', 'admin_notice', 'worker_wake')),
  ran_at timestamptz not null default now(),
  period jsonb not null default '{}'::jsonb,
  deleted jsonb not null default '{}'::jsonb,
  protected_skipped integer not null default 0,
  files_queued integer not null default 0,
  error text
);
create index if not exists retention_deletion_records_ran_idx on public.retention_deletion_records (ran_at desc, category);
alter table public.retention_deletion_records enable row level security;
revoke all on public.retention_deletion_records from public, anon, authenticated, service_role;

create or replace function public.retention_records_are_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Retention records can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.retention_records_are_append_only() from public, anon, authenticated, service_role;
drop trigger if exists retention_deletion_records_no_change on public.retention_deletion_records;
create trigger retention_deletion_records_no_change before update or delete on public.retention_deletion_records
  for each row execute function public.retention_records_are_append_only();
drop trigger if exists retention_deletion_records_no_truncate on public.retention_deletion_records;
create trigger retention_deletion_records_no_truncate before truncate on public.retention_deletion_records
  for each statement execute function public.retention_records_are_append_only();

-- Small internal helpers (not callable through the API) -----------------------------------------------------------------------------

create or replace function public.retention_fy_month()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v integer;
begin
  select nullif(s.setting_value #>> '{}', '')::integer into v from public.system_settings s where s.setting_key = 'retention_financial_year_end_month';
  return case when v between 1 and 12 then v else null end;
exception when others then
  return null;
end;
$$;

-- The master switch: only the JSON value true turns the job on. A missing, null, text or unreadable setting is OFF.
create or replace function public.retention_jobs_are_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'retention_jobs_enabled'), false);
$$;

-- A retention period in years: the setting, but never below the shipped default (a retention setting can only lengthen a period) and
-- never above 100. Zero, negative, empty and unreadable values fall back to the default (closure_int_setting).
create or replace function public.retention_years(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select least(greatest(public.closure_int_setting(p_key, p_default), p_default), 100);
$$;

-- The most rows one run deletes per table: the setting, 1 to 250 (unreadable or below 1 = 100).
create or replace function public.retention_run_cap()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select least(public.closure_int_setting('retention_max_per_run', 100), 250);
$$;

-- Fails closed when a status name the SQL relies on is not one the column allows (a renamed status would otherwise match nothing, silently).
-- Works for an enum column and for a column with a CHECK constraint listing its values.
create or replace function public.retention_assert_names(p_table regclass, p_column name, p_names text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type oid;
  v_kind "char";
  v_defs text;
  v_missing text[];
begin
  select a.atttypid into v_type from pg_attribute a where a.attrelid = p_table and a.attname = p_column and a.attnum > 0 and not a.attisdropped;
  if v_type is null then
    raise exception 'The retention job relies on %.% but that column does not exist', p_table::text, p_column;
  end if;
  select t.typtype into v_kind from pg_type t where t.oid = v_type;
  if v_kind = 'e' then
    select array_agg(n) into v_missing from unnest(p_names) n
    where not exists (select 1 from pg_enum e where e.enumtypid = v_type and e.enumlabel = n);
  else
    select string_agg(pg_get_constraintdef(c.oid), ' ') into v_defs from pg_constraint c
    where c.conrelid = p_table and c.contype = 'c'
      and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = p_column and a.attnum = any (c.conkey));
    select array_agg(n) into v_missing from unnest(p_names) n where v_defs is null or position(quote_literal(n) in v_defs) = 0;
  end if;
  if v_missing is not null then
    raise exception 'The retention job relies on status name(s) % of %.% that it does not allow', array_to_string(v_missing, ', '), p_table::text, p_column;
  end if;
end;
$$;

-- Fails closed when the foreign keys that point at a table are not exactly the ones the SQL was written for ('child.column:action', the action
-- being the pg_constraint letter: c cascade, n set null, a no action). A new cascading key would silently delete more than we mean to.
create or replace function public.retention_assert_foreign_keys(p_parent regclass, p_expected text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_found text[];
  v_bad text[];
begin
  select coalesce(array_agg(x.k order by x.k), '{}'::text[]) into v_found from (
    select c.conrelid::regclass::text || '.' || (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey))
           || ':' || c.confdeltype::text as k
    from pg_constraint c where c.contype = 'f' and c.confrelid = p_parent
  ) x;
  select array_agg(q.z order by q.z) into v_bad from (
    select 'unexpected ' || u as z from unnest(v_found) u where not (u = any (coalesce(p_expected, '{}'::text[])))
    union all
    select 'missing ' || e from unnest(coalesce(p_expected, '{}'::text[])) e where not (e = any (v_found))
  ) q;
  if v_bad is not null then
    raise exception 'The foreign keys on % are not what the retention job expects: %', p_parent::text, array_to_string(v_bad, ', ');
  end if;
end;
$$;

-- The day after which a money record dated p_date may be deleted: the end of the financial year it falls in, plus the years. With no year-end
-- chosen: the later of p_date + 8 years (the design's fixed bound) and p_date + 1 year (no year-end is later than that) + the years, so never
-- earlier than the real rule. Deletable when this is before today.
create or replace function public.retention_money_cutoff(p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month integer := public.retention_fy_month();
  v_years integer := public.retention_years('retention_money_years', 7);
  v_end date;
begin
  if p_date is null then
    return null;
  end if;
  if v_month is null then
    return greatest((p_date + interval '8 years')::date, (p_date + make_interval(years => v_years + 1))::date);
  end if;
  v_end := (make_date(extract(year from p_date)::integer, v_month, 1) + interval '1 month' - interval '1 day')::date;
  if v_end < p_date then
    v_end := (make_date(extract(year from p_date)::integer + 1, v_month, 1) + interval '1 month' - interval '1 day')::date;
  end if;
  return (v_end + make_interval(years => v_years))::date;
end;
$$;

-- True if the person's clock (closing) is older than p_years. Protection is checked separately.
create or replace function public.retention_closed_before(p_profile uuid, p_years integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.account_tombstones t where t.profile_id = p_profile and t.closed_at <= now() - make_interval(years => p_years));
$$;

-- True only if there is at least one person named and EVERY named person has closed more than p_years ago (a null is "nobody").
create or replace function public.retention_all_closed_before(p_years integer, variadic p_profiles uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from unnest(p_profiles) x where x is not null)
     and not exists (select 1 from unnest(p_profiles) x where x is not null and not public.retention_closed_before(x, p_years));
$$;

-- True if anything stops deletions for this person: a safety hold, an open problem report, a hand-over prepared and not delivered, or an
-- admin deferral still running. Takes no lock; used for counting and as the first half of retention_person_protected.
create or replace function public.retention_person_blocked(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile is not null and (
    public.profile_is_on_safety_hold(p_profile)
    or public.closure_has_open_dispute(p_profile)
    or exists (select 1 from public.hand_over_events e
               where e.subject_id = p_profile and e.event = 'prepared'
                 and not exists (select 1 from public.hand_over_events d where d.event = 'delivered' and d.hand_over_id = e.id))
    or exists (select 1 from public.account_closures c where c.profile_id = p_profile and c.deferred_until is not null and c.deferred_until > now()));
$$;

-- Like retention_person_blocked, and when nothing stops it, takes the same lock place_safety_hold() takes (same key, held to the end of the
-- transaction, so the number of people one run checks is bounded by retention_max_per_run) and looks at the hold again, so a hold being
-- placed while the job runs is seen (a hold placed a moment later waits for this run to finish).
create or replace function public.retention_person_protected(p_profile uuid)
returns boolean
language plpgsql
volatile
cost 10000
security definer
set search_path = public
as $$
begin
  if p_profile is null then
    return false;
  end if;
  if public.retention_person_blocked(p_profile) then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || p_profile::text, 0));
  return public.profile_is_on_safety_hold(p_profile);
end;
$$;

-- One protected person among those named makes the row protected.
create or replace function public.retention_any_protected(variadic p_profiles uuid[])
returns boolean
language plpgsql
volatile
cost 10000
security definer
set search_path = public
as $$
declare x uuid;
begin
  foreach x in array coalesce(p_profiles, '{}'::uuid[]) loop
    if x is not null and public.retention_person_protected(x) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The same without taking any lock (for counting how many rows were past their time but stopped).
create or replace function public.retention_any_blocked(variadic p_profiles uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from unnest(p_profiles) x where x is not null and public.retention_person_blocked(x));
$$;

-- Everyone a problem report involves: who raised it and the session's learner, tutor and booker.
create or replace function public.retention_dispute_people(p_dispute uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select array[d.raised_by_id, s.student_id, s.tutor_id, s.booked_by_profile_id]
  from public.platform_disputes d left join public.sessions s on s.id = d.session_id
  where d.id = p_dispute;
$$;

-- When a tutor who never closed counts as having stopped: not accepting requests, nothing booked or running, and the last of their
-- activity (profile created or changed, last session date, last document uploaded or reviewed). Null = not stopped (or the rule is off).
-- (Only ever delays a deletion: the activity dates are taken with greatest().)
create or replace function public.retention_tutor_stopped_at(p_tutor uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on boolean := false;
  tp record;
begin
  -- Off unless the setting says true: a missing or unreadable setting never starts a clock.
  begin
    select coalesce((s.setting_value #>> '{}')::boolean, false) into v_on from public.system_settings s where s.setting_key = 'retention_quiet_tutor_rule';
  exception when others then
    v_on := false;
  end;
  if not coalesce(v_on, false) then
    return null;
  end if;
  perform public.retention_assert_names('public.sessions', 'status', array['pending_confirmation', 'scheduled', 'in_progress']);
  select t.is_dispatch_active, t.created_at, t.updated_at into tp from public.tutor_profiles t where t.id = p_tutor;
  if not found or tp.is_dispatch_active then
    return null;
  end if;
  if exists (select 1 from public.sessions s where s.tutor_id = p_tutor and s.status::text in ('pending_confirmation', 'scheduled', 'in_progress')) then
    return null;
  end if;
  return greatest(tp.created_at, tp.updated_at,
                  (select max(s.scheduled_start) from public.sessions s where s.tutor_id = p_tutor),
                  (select max(greatest(d.uploaded_at, d.reviewed_at)) from public.tutor_verification_documents d where d.tutor_id = p_tutor));
end;
$$;

-- The tutor's clock starts at the earlier of closing (the tombstone) and stopping.
create or replace function public.retention_tutor_anchor(p_tutor uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select least((select t.closed_at from public.account_tombstones t where t.profile_id = p_tutor), public.retention_tutor_stopped_at(p_tutor));
$$;

-- True while any kept record still points at the person (so the tombstone must stay): a booking, request, payout, a problem report they raised
-- or sat in, an acceptance or consent record, a tutor's documents, audit lines or Tier 1 records, a stored file of theirs, or a file-removal
-- step still open.
create or replace function public.retention_has_kept_records(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sessions s where p_profile in (s.student_id, s.tutor_id, s.booked_by_profile_id))
      or exists (select 1 from public.session_requests r where p_profile in (r.student_id, r.requested_by_profile_id, r.tutor_id, r.requested_tutor_id))
      or exists (select 1 from public.payouts po where po.tutor_id = p_profile)
      or exists (select 1 from public.platform_disputes d where d.raised_by_id = p_profile)
      or exists (select 1 from public.platform_disputes d join public.sessions s on s.id = d.session_id where p_profile in (s.student_id, s.tutor_id, s.booked_by_profile_id))
      or exists (select 1 from public.policy_acceptances a where p_profile in (a.profile_id, a.accepted_by_profile_id))
      or exists (select 1 from public.guardian_consents g where p_profile in (g.guardian_profile_id, g.learner_profile_id))
      or exists (select 1 from public.tutor_onboarding o where o.tutor_id = p_profile)
      or exists (select 1 from public.school_results_consents c where p_profile in (c.student_id, c.consented_by))
      or exists (select 1 from public.tutor_verification_documents v where v.tutor_id = p_profile)
      or exists (select 1 from public.tutor_verification_audits au where au.tutor_id = p_profile)
      or exists (select 1 from public.tier1_academic_records a where a.tutor_id = p_profile)
      or exists (select 1 from storage.objects f where f.bucket_id in ('tutor-documents', 'school-results') and split_part(f.name, '/', 1) = p_profile::text)
      or exists (select 1 from public.account_closure_tasks k where k.profile_id = p_profile and k.kind = 'storage_remove' and k.status in ('pending', 'claimed'));
$$;

-- True when the person's latest closure is finished ('done': every step outside the database ran) and no step of theirs is still open.
-- A person with no closure row at all (nothing to wait for) counts as finished; 'undone' (they came back), 'closed' and 'db_deleted' do not.
create or replace function public.retention_closure_finished(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.status = 'done' from public.account_closures c where c.profile_id = p_profile order by c.closed_at desc, c.id limit 1), true)
     and not exists (select 1 from public.account_closure_tasks k where k.profile_id = p_profile and k.status in ('pending', 'claimed'));
$$;

-- What is due, with the people each row involves. Each checks its status names first (see retention_assert_names). Only SETTLED money:
--   payouts: paid. Requests: a final request status, a settled payment status, no unsettled card-check refund and no charge-check alarm, AND
--   the session it made is finished and no payout line or problem report still points at it. Sessions: finished, with no request, payout
--   line or report pointing at them and no room still open.
create or replace function public.retention_due_payouts()
returns table (rec_id uuid, people uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.retention_assert_names('public.payouts', 'status', array['paid']);
  return query
    select po.id, array[po.tutor_id] from public.payouts po
    where po.status::text = any (array['paid'])
      and public.retention_money_cutoff(greatest(po.period_end, po.paid_at::date, po.created_at::date)) < current_date;
end;
$$;

create or replace function public.retention_due_requests()
returns table (rec_id uuid, people uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_final text[] := array['accepted', 'declined', 'expired', 'cancelled'];
  v_settled text[] := array['unpaid', 'card_verified', 'charge_failed', 'paid', 'refunded', 'failed'];
  v_done text[] := array['completed', 'cancelled_by_tutor', 'cancelled_by_student'];
begin
  perform public.retention_assert_names('public.session_requests', 'status', v_final);
  perform public.retention_assert_names('public.session_requests', 'payment_status', v_settled);
  perform public.retention_assert_names('public.sessions', 'status', v_done);
  return query
    select r.id, array[r.student_id, r.requested_by_profile_id, r.tutor_id, r.requested_tutor_id]
    from public.session_requests r
    where r.status::text = any (v_final)
      and r.payment_status::text = any (v_settled)
      and coalesce(r.card_check_refund_status, 'queued') = 'queued'
      and coalesce(r.charge_check_request_id, 0) <> -1
      and public.retention_money_cutoff(greatest(r.created_at, r.requested_start, r.charged_at, r.refund_requested_at, r.refunded_at, r.responded_at)::date) < current_date
      and (r.resulting_session_id is null
           or exists (select 1 from public.sessions s where s.id = r.resulting_session_id and s.status::text = any (v_done)))
      and not exists (select 1 from public.payout_sessions ps where ps.session_id = r.resulting_session_id)
      and not exists (select 1 from public.platform_disputes d where d.session_id = r.resulting_session_id);
end;
$$;

create or replace function public.retention_due_sessions()
returns table (rec_id uuid, people uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_done text[] := array['completed', 'cancelled_by_tutor', 'cancelled_by_student'];
begin
  perform public.retention_assert_names('public.sessions', 'status', v_done);
  return query
    select s.id, array[s.student_id, s.tutor_id, s.booked_by_profile_id]
    from public.sessions s
    where s.status::text = any (v_done)
      and public.retention_money_cutoff(greatest(s.scheduled_start, s.completed_at, s.created_at)::date) < current_date
      and not exists (select 1 from public.session_requests r where r.resulting_session_id = s.id)
      and not exists (select 1 from public.payout_sessions ps where ps.session_id = s.id)
      and not exists (select 1 from public.platform_disputes d where d.session_id = s.id)
      and not exists (select 1 from public.video_rooms vr where vr.session_id = s.id and vr.ended_at is null and vr.expires_at > now());
end;
$$;

-- The five categories --------------------------------------------------------------------------------------------------------------
-- Each returns {years, row_cap, capped, deleted:{table: n}, protected: n past their time but protected, files: n queued for the Worker}.
-- Counts in "deleted" are the rows each DELETE reported, never counted beforehand. A row is "protected" when it was past its time and a
-- person on it was on hold / had an open report / a hand-over not delivered / a running deferral.

create or replace function public.retention_run_tutor_documents(p_run uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_years integer := public.retention_years('retention_documents_years', 3);
  v_cap integer := public.retention_run_cap();
  t record;
  v_anchor timestamptz;
  v_paths text[];
  v_open text[];
  v_new text[];
  n integer;
  n_docs integer := 0;
  n_audits integer := 0;
  n_t1 integer := 0;
  n_links integer := 0;
  n_prot integer := 0;
  n_files integer := 0;
  n_done integer := 0;
  v_capped boolean := false;
begin
  perform public.retention_assert_foreign_keys('public.tutor_verification_documents', array['tutor_credentials.document_id:n', 'tutor_verification_audits.document_id:c']);
  perform public.retention_assert_foreign_keys('public.tier1_academic_records', '{}'::text[]);
  -- Every tutor id with a document, a Tier 1 record or a stored file: NOT started from tutor_profiles, so a tutor whose profile row is gone
  -- (their stored files are not tied to it by any key) is still found.
  for t in
    select x.id from (
      select d.tutor_id as id from public.tutor_verification_documents d
      union
      select a.tutor_id from public.tier1_academic_records a
      union
      select case when split_part(o.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(o.name, '/', 1)::uuid end
      from storage.objects o where o.bucket_id = 'tutor-documents'
    ) x where x.id is not null
    order by x.id
  loop
    v_anchor := public.retention_tutor_anchor(t.id);
    if v_anchor is null or v_anchor > now() - make_interval(years => v_years) then
      continue;
    end if;
    if public.retention_person_blocked(t.id) then
      n_prot := n_prot + 1;
      continue;
    end if;
    if n_done >= v_cap then
      v_capped := true;
      continue;
    end if;
    if public.retention_person_protected(t.id) then
      n_prot := n_prot + 1;
      continue;
    end if;
    n_done := n_done + 1;
    select coalesce(array_agg(distinct s.x), '{}'::text[]) into v_paths from (
      select o.name as x from storage.objects o where o.bucket_id = 'tutor-documents' and split_part(o.name, '/', 1) = t.id::text
      union select d.document_url from public.tutor_verification_documents d where d.tutor_id = t.id and d.document_url !~* '^https?://'
      union select a.document_path from public.tier1_academic_records a where a.tutor_id = t.id and a.document_path !~* '^https?://'
    ) s where s.x is not null and s.x <> '';
    -- Files already named by a step still open are not queued again; every other path is (including one held only in a row about to go).
    select coalesce(array_agg(distinct p.x), '{}'::text[]) into v_open
    from public.account_closure_tasks k,
         lateral jsonb_array_elements_text(case when jsonb_typeof(k.payload -> 'paths') = 'array' then k.payload -> 'paths' else '[]'::jsonb end) as p(x)
    where k.profile_id = t.id and k.kind = 'storage_remove' and k.status in ('pending', 'claimed') and k.payload ->> 'bucket' = 'tutor-documents';
    select coalesce(array_agg(u.x), '{}'::text[]) into v_new from unnest(v_paths) u(x) where not (u.x = any (v_open));
    if coalesce(array_length(v_new, 1), 0) > 0 then
      perform public.closure_enqueue_files(p_run, t.id, 'tutor-documents', v_new);
      n_files := n_files + array_length(v_new, 1);
    end if;
    -- The rows, each step explicit (no reliance on a foreign key to do it): the credential's link to the document emptied, the audit lines,
    -- the documents, the Tier 1 records.
    update public.tutor_credentials set document_id = null
    where document_id in (select d.id from public.tutor_verification_documents d where d.tutor_id = t.id);
    get diagnostics n = row_count; n_links := n_links + n;
    delete from public.tutor_verification_audits where tutor_id = t.id;
    get diagnostics n = row_count; n_audits := n_audits + n;
    delete from public.tutor_verification_documents where tutor_id = t.id;
    get diagnostics n = row_count; n_docs := n_docs + n;
    delete from public.tier1_academic_records where tutor_id = t.id;
    get diagnostics n = row_count; n_t1 := n_t1 + n;
  end loop;
  return jsonb_build_object('years', v_years, 'row_cap', v_cap, 'capped', v_capped, 'credential_links_emptied', n_links, 'protected', n_prot, 'files', n_files,
    'deleted', jsonb_build_object('tutor_verification_documents', n_docs, 'tutor_verification_audits', n_audits, 'tier1_academic_records', n_t1));
end;
$$;

create or replace function public.retention_run_consent_records()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_years integer := public.retention_years('retention_consent_years', 5);
  v_cap integer := public.retention_run_cap();
  n integer;
  n_prot integer := 0;
  v_capped boolean := false;
  v_del jsonb := '{}'::jsonb;
begin
  perform public.retention_assert_foreign_keys('public.policy_acceptances', '{}'::text[]);
  perform public.retention_assert_foreign_keys('public.guardian_consents', '{}'::text[]);
  perform public.retention_assert_foreign_keys('public.tutor_onboarding', '{}'::text[]);
  perform public.retention_assert_foreign_keys('public.school_results_consents', '{}'::text[]);

  -- A row naming two people goes only when BOTH have closed more than the period ago (never for someone who has not closed).
  select count(*) into n from public.policy_acceptances a
  where public.retention_all_closed_before(v_years, a.profile_id, a.accepted_by_profile_id) and public.retention_any_blocked(a.profile_id, a.accepted_by_profile_id);
  n_prot := n_prot + n;
  delete from public.policy_acceptances where ctid in (
    select a.ctid from public.policy_acceptances a
    where public.retention_all_closed_before(v_years, a.profile_id, a.accepted_by_profile_id) and not public.retention_any_protected(a.profile_id, a.accepted_by_profile_id)
    limit v_cap);
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('policy_acceptances', n); v_capped := v_capped or n >= v_cap;

  select count(*) into n from public.guardian_consents g
  where public.retention_all_closed_before(v_years, g.learner_profile_id, g.guardian_profile_id) and public.retention_any_blocked(g.learner_profile_id, g.guardian_profile_id);
  n_prot := n_prot + n;
  delete from public.guardian_consents where ctid in (
    select g.ctid from public.guardian_consents g
    where public.retention_all_closed_before(v_years, g.learner_profile_id, g.guardian_profile_id) and not public.retention_any_protected(g.learner_profile_id, g.guardian_profile_id)
    limit v_cap);
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('guardian_consents', n); v_capped := v_capped or n >= v_cap;

  select count(*) into n from public.tutor_onboarding o
  where public.retention_all_closed_before(v_years, o.tutor_id) and public.retention_any_blocked(o.tutor_id);
  n_prot := n_prot + n;
  delete from public.tutor_onboarding where ctid in (
    select o.ctid from public.tutor_onboarding o
    where public.retention_all_closed_before(v_years, o.tutor_id) and not public.retention_any_protected(o.tutor_id)
    limit v_cap);
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_onboarding', n); v_capped := v_capped or n >= v_cap;

  select count(*) into n from public.school_results_consents c
  where public.retention_all_closed_before(v_years, c.student_id, c.consented_by) and public.retention_any_blocked(c.student_id, c.consented_by);
  n_prot := n_prot + n;
  delete from public.school_results_consents where ctid in (
    select c.ctid from public.school_results_consents c
    where public.retention_all_closed_before(v_years, c.student_id, c.consented_by) and not public.retention_any_protected(c.student_id, c.consented_by)
    limit v_cap);
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('school_results_consents', n); v_capped := v_capped or n >= v_cap;

  return jsonb_build_object('years', v_years, 'row_cap', v_cap, 'capped', v_capped, 'protected', n_prot, 'files', 0, 'deleted', v_del);
end;
$$;

create or replace function public.retention_run_problem_reports()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_years integer := public.retention_years('retention_reports_years', 5);
  v_cap integer := public.retention_run_cap();
  v_resolved text[] := array['resolved_refunded', 'resolved_payout', 'dismissed'];
  v_ids uuid[];
  n integer;
  n_prot integer;
begin
  perform public.retention_assert_names('public.platform_disputes', 'status', v_resolved);
  perform public.retention_assert_foreign_keys('public.platform_disputes', '{}'::text[]);
  select count(*) into n_prot from public.platform_disputes d
  where d.status::text = any (v_resolved) and coalesce(d.resolved_at, d.created_at) <= now() - make_interval(years => v_years)
    and public.retention_any_blocked(variadic public.retention_dispute_people(d.id));
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids from (
    select d.id from public.platform_disputes d
    where d.status::text = any (v_resolved) and coalesce(d.resolved_at, d.created_at) <= now() - make_interval(years => v_years)
      and not public.retention_any_protected(variadic public.retention_dispute_people(d.id))
    limit v_cap) x;
  delete from public.platform_disputes where id = any (v_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('years', v_years, 'row_cap', v_cap, 'capped', n >= v_cap, 'protected', n_prot, 'files', 0, 'deleted', jsonb_build_object('platform_disputes', n));
end;
$$;

create or replace function public.retention_run_money_records()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_years integer := public.retention_years('retention_money_years', 7);
  v_cap integer := public.retention_run_cap();
  v_ids uuid[];
  n integer;
  n2 integer;
  n3 integer;
  n4 integer;
  n_prot integer := 0;
  v_capped boolean := false;
  v_del jsonb := '{}'::jsonb;
begin
  perform public.retention_assert_foreign_keys('public.payouts', array['payout_sessions.payout_id:c']);
  perform public.retention_assert_foreign_keys('public.session_requests', array['session_requests.resent_from:n']);
  perform public.retention_assert_foreign_keys('public.sessions', array['conversations.session_id:n', 'notifications.related_session_id:n', 'payout_sessions.session_id:c',
    'platform_disputes.session_id:c', 'reviews.session_id:c', 'session_requests.resulting_session_id:n', 'video_rooms.session_id:c']);
  perform public.retention_assert_foreign_keys('public.video_rooms', array['video_room_members.room_id:c']);

  -- Payouts that are paid (their lines go with them).
  select count(*) into n from public.retention_due_payouts() q where public.retention_any_blocked(variadic q.people);
  n_prot := n_prot + n;
  select coalesce(array_agg(x.rec_id), '{}'::uuid[]) into v_ids from (
    select q.rec_id from public.retention_due_payouts() q where not public.retention_any_protected(variadic q.people) limit v_cap) x;
  delete from public.payout_sessions where payout_id = any (v_ids);
  get diagnostics n2 = row_count;
  delete from public.payouts where id = any (v_ids);
  get diagnostics n = row_count;
  v_del := v_del || jsonb_build_object('payouts', n, 'payout_sessions', n2); v_capped := v_capped or n >= v_cap;

  -- Payments and refunds (session requests) whose money is settled, whose session is finished and which no payout line or report points at.
  select count(*) into n from public.retention_due_requests() q where public.retention_any_blocked(variadic q.people);
  n_prot := n_prot + n;
  select coalesce(array_agg(x.rec_id), '{}'::uuid[]) into v_ids from (
    select q.rec_id from public.retention_due_requests() q where not public.retention_any_protected(variadic q.people) limit v_cap) x;
  delete from public.session_requests where id = any (v_ids);
  get diagnostics n = row_count;
  v_del := v_del || jsonb_build_object('session_requests', n); v_capped := v_capped or n >= v_cap;

  -- Finished sessions nothing else points at any more (a request, a payout line or a report not yet due keeps the session). Their reviews and
  -- rooms are deleted with them, each step explicit.
  select count(*) into n from public.retention_due_sessions() q where public.retention_any_blocked(variadic q.people);
  n_prot := n_prot + n;
  select coalesce(array_agg(x.rec_id), '{}'::uuid[]) into v_ids from (
    select q.rec_id from public.retention_due_sessions() q where not public.retention_any_protected(variadic q.people) limit v_cap) x;
  delete from public.reviews where session_id = any (v_ids);
  get diagnostics n2 = row_count;
  delete from public.video_room_members where room_id in (select vr.id from public.video_rooms vr where vr.session_id = any (v_ids));
  get diagnostics n4 = row_count;
  delete from public.video_rooms where session_id = any (v_ids);
  get diagnostics n3 = row_count;
  delete from public.sessions where id = any (v_ids);
  get diagnostics n = row_count;
  v_del := v_del || jsonb_build_object('sessions', n, 'reviews', n2, 'video_rooms', n3, 'video_room_members', n4); v_capped := v_capped or n >= v_cap;

  return jsonb_build_object('years', v_years, 'financial_year_end_month', public.retention_fy_month(), 'row_cap', v_cap, 'capped', v_capped,
    'protected', n_prot, 'files', 0, 'deleted', v_del);
end;
$$;

create or replace function public.retention_run_tombstones()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cap integer := public.retention_run_cap();
  -- The name key is kept at least as long as the shortest retention period after closing, even when nothing else is kept.
  v_min integer := least(public.retention_years('retention_documents_years', 3), public.retention_years('retention_consent_years', 5),
                         public.retention_years('retention_reports_years', 5), public.retention_years('retention_money_years', 7));
  t record;
  n_gone integer := 0;
  n_text integer := 0;
  n_prot integer := 0;
  n integer;
  v_capped boolean := false;
begin
  perform public.retention_assert_foreign_keys('public.account_tombstones', '{}'::text[]);
  for t in select ts.profile_id, ts.closed_at from public.account_tombstones ts order by ts.profile_id loop
    if t.closed_at > now() - make_interval(years => v_min) then
      continue;
    end if;
    if not public.retention_closure_finished(t.profile_id) then
      continue;
    end if;
    if public.retention_has_kept_records(t.profile_id) then
      continue;
    end if;
    if public.retention_person_blocked(t.profile_id) then
      n_prot := n_prot + 1;
      continue;
    end if;
    if n_gone >= v_cap then
      v_capped := true;
      continue;
    end if;
    if public.retention_person_protected(t.profile_id) then
      n_prot := n_prot + 1;
      continue;
    end if;
    -- The tombstone goes (the closing date stays in account_closures.closed_at and account_deletion_records.closed_at); who asked, how they
    -- were checked, the reference, the admin's note and the undo note (built from the same names) are blanked. The deferral reason is kept.
    delete from public.account_tombstones where profile_id = t.profile_id;
    get diagnostics n = row_count; n_gone := n_gone + n;
    update public.account_closures
    set asked_by = null, how_verified = null, reference = null, note = null, undone_note = null
    where profile_id = t.profile_id
      and (asked_by is not null or how_verified is not null or reference is not null or note is not null or undone_note is not null);
    get diagnostics n = row_count; n_text := n_text + n;
  end loop;
  return jsonb_build_object('min_years_kept', v_min, 'row_cap', v_cap, 'capped', v_capped, 'protected', n_prot, 'files', 0,
    'deleted', jsonb_build_object('account_tombstones', n_gone, 'closure_texts_blanked', n_text));
end;
$$;

-- The daily job ------------------------------------------------------------------------------------------------------------------

create or replace function public.run_retention_jobs()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run uuid := gen_random_uuid();
  v_cat text;
  j jsonb;
  v_err text;
  n_err integer := 0;
  n_files integer := 0;
  n_notice_err integer := 0;
  v_summary jsonb := '{}'::jsonb;
begin
  -- The master switch: off (the shipped state) = do nothing at all, not even a journal row.
  if not public.retention_jobs_are_on() then
    return jsonb_build_object('skipped', 'the retention job is switched off');
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('retention_jobs', 0)) then
    return jsonb_build_object('skipped', 'another run is in progress');
  end if;
  foreach v_cat in array array['tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'tombstones'] loop
    j := null;
    v_err := null;
    begin
      j := case v_cat
             when 'tutor_documents' then public.retention_run_tutor_documents(v_run)
             when 'consent_records' then public.retention_run_consent_records()
             when 'problem_reports' then public.retention_run_problem_reports()
             when 'money_records' then public.retention_run_money_records()
             else public.retention_run_tombstones()
           end;
    exception when others then
      v_err := left(sqlerrm, 300);
      n_err := n_err + 1;
      j := null;
    end;
    insert into public.retention_deletion_records (run_id, category, period, deleted, protected_skipped, files_queued, error)
    values (v_run, v_cat,
            case when j is null then '{}'::jsonb else j - 'deleted' - 'protected' - 'files' end,
            coalesce(j -> 'deleted', '{}'::jsonb), coalesce((j ->> 'protected')::integer, 0), coalesce((j ->> 'files')::integer, 0), v_err);
    n_files := n_files + coalesce((j ->> 'files')::integer, 0);
    v_summary := v_summary || jsonb_build_object(v_cat, coalesce(j -> 'deleted', 'null'::jsonb));
  end loop;
  -- Telling the admins and waking the Worker each have their own handler: a failure here never undoes the run (the files are already queued
  -- and the deletions journalled; the Worker also finds queued steps on its own schedule).
  if n_err > 0 then
    begin
      perform public.notify_active_admins('retention_error', 'A retention job step failed',
        'Run ' || v_run || ': ' || n_err || ' of 5 categories failed and were rolled back on their own. Their error is in retention_deletion_records; the others ran.');
    exception when others then
      n_notice_err := n_notice_err + 1;
      insert into public.retention_deletion_records (run_id, category, error) values (v_run, 'admin_notice', left(sqlerrm, 300));
    end;
  end if;
  if n_files > 0 then
    begin
      perform public.closure_wake_worker();
    exception when others then
      n_notice_err := n_notice_err + 1;
      insert into public.retention_deletion_records (run_id, category, error) values (v_run, 'worker_wake', left(sqlerrm, 300));
    end;
  end if;
  return jsonb_build_object('run_id', v_run, 'errors', n_err, 'notice_errors', n_notice_err, 'files_queued', n_files, 'deleted', v_summary);
end;
$$;

-- Schedules the daily job (03:40, after the 03:10 closure job). Without pg_cron it FAILS (the migration is then not applied) instead of
-- quietly scheduling nothing. The argument exists only so a test can prove the failure path.
create or replace function public.retention_schedule_job(p_extension text default 'pg_cron')
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = p_extension) then
    raise exception 'pg_cron is not installed, so the daily retention job cannot be scheduled';
  end if;
  perform cron.unschedule('run-retention-jobs') where exists (select 1 from cron.job where jobname = 'run-retention-jobs');
  perform cron.schedule('run-retention-jobs', '40 3 * * *', 'select public.run_retention_jobs();');
end;
$$;

-- Rights ------------------------------------------------------------------------------------------------------------------------------
-- Nobody through the API: the daily job runs as the owner.
revoke all on function public.retention_fy_month() from public, anon, authenticated, service_role;
revoke all on function public.retention_money_cutoff(date) from public, anon, authenticated, service_role;
revoke all on function public.retention_closed_before(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.retention_person_protected(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_any_protected(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.retention_tutor_stopped_at(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_tutor_anchor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_has_kept_records(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_run_tutor_documents(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_run_consent_records() from public, anon, authenticated, service_role;
revoke all on function public.retention_run_problem_reports() from public, anon, authenticated, service_role;
revoke all on function public.retention_run_money_records() from public, anon, authenticated, service_role;
revoke all on function public.retention_run_tombstones() from public, anon, authenticated, service_role;
revoke all on function public.run_retention_jobs() from public, anon, authenticated, service_role;
revoke all on function public.retention_jobs_are_on() from public, anon, authenticated, service_role;
revoke all on function public.retention_years(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.retention_run_cap() from public, anon, authenticated, service_role;
revoke all on function public.retention_assert_names(regclass, name, text[]) from public, anon, authenticated, service_role;
revoke all on function public.retention_assert_foreign_keys(regclass, text[]) from public, anon, authenticated, service_role;
revoke all on function public.retention_all_closed_before(integer, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.retention_person_blocked(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_any_blocked(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.retention_dispute_people(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_closure_finished(uuid) from public, anon, authenticated, service_role;
revoke all on function public.retention_due_payouts() from public, anon, authenticated, service_role;
revoke all on function public.retention_due_requests() from public, anon, authenticated, service_role;
revoke all on function public.retention_due_sessions() from public, anon, authenticated, service_role;
revoke all on function public.retention_schedule_job(text) from public, anon, authenticated, service_role;

do $$
begin
  perform public.retention_schedule_job();
end $$;
