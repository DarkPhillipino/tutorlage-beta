-- Tier 1 by documents (CEO, 21 Oct 2026: "documents first, test later when training and tests are ready for launch"; the educator's view the CEO adopted).
-- NOT applied. Apply AFTER 20261012090200_tier1_pipeline.sql (already on dev). Replaces four functions, adds one function, one column, three settings.
-- Until now a tutor without a teaching qualification got a subject verified only by passing all three gates: a checked record of 70%+, all seven training
-- modules (two of them live with a trainer) and the diagnostic test. The CEO wants launch to go on documents; the training and the test come back later.
-- The setting tier1_route says which route is on:
--   'documents' (the default after this migration): a subject becomes VERIFIED, with no test and no live module, when
--       1. an admin has checked the tutor's record for it (at least tier1_min_subject_pct, 70, on a document the admin has read), AND
--       2. the tutor has passed Module 7 (safeguarding, every scenario right) AND has agreed to the tutor code of conduct (recorded on the Module 7 row).
--       The admin must write down what they checked (at least 20 characters; the admin screen builds it from a four-point checklist). Whichever of the
--       two comes last triggers the grant, so the order does not matter. Modules 1 to 6 stay readable as an optional guide, no gate.
--       Grade range (the educator's idea): a tutor whose best verified mark is under tier1_documents_wide_mark_pct (80) starts with a ceiling of
--       tier1_documents_narrow_max_grade (Grade 10); a mark of 80+ keeps Grade 8 to 12. Set the ceiling to 'Grade 12' to switch it off. An admin can
--       widen a range by hand later; the grant never re-caps a subject that is already verified.
--   'full': exactly the old route (record, all seven modules, trainer sign-offs, the test). Nothing about it changes; run it again by setting
--       tier1_route to 'full' ("test later").
-- REPLACES (same signature, same grants, same attributes; each is restated in full below):
--   tier1_training_complete(uuid)      documents route: Module 7 passed AND the code of conduct agreed; full route: as before (all seven modules)
--   admin_check_tier1_record(uuid, text, text)   a 'verified' verdict in the documents route needs a written note, and triggers the grant
--   tier1_submit_module_check(jsonb)   also reads an optional "conduct": true in the answers, stores the agreement on the Module 7 row, triggers the grant
--   tier1_status(text)                 same reply plus route, safeguarding_done, conduct_accepted, subject_verified, min_pct; documents-route reasons
-- ADDS: tier1_training.conduct_accepted_at; function tier1_grant_documents(uuid) (internal, no API role); three settings rows.
-- The test stays callable in the database (tier1_start_test is not touched) but the screen does not offer it in the documents route.
-- A tutor who has used the route before this migration: none have (dev has 0 records, 0 training rows, 0 attempts on 21 Oct); in the full route
-- nothing needs redoing.

insert into public.system_settings (setting_key, setting_value, description) values
  ('tier1_route', '"documents"'::jsonb, 'Tier 1 route: documents = an admin-checked record (70%+) plus Module 7 (safeguarding) and the code of conduct verify a subject; full = record, all seven modules and the test.'),
  ('tier1_documents_wide_mark_pct', '80'::jsonb, 'Documents route: a best verified mark at or above this keeps the full Grade 8 to 12 range; below it the range is capped at tier1_documents_narrow_max_grade.'),
  ('tier1_documents_narrow_max_grade', '"Grade 10"'::jsonb, 'Documents route: the highest grade a tutor starts with when their best verified mark is under tier1_documents_wide_mark_pct. Set to Grade 12 to switch the cap off.')
on conflict (setting_key) do nothing;

alter table public.tier1_training add column if not exists conduct_accepted_at timestamptz;

-- Module 7 and the code of conduct (documents route) or all seven modules (full route). The full-route part is the old text.
create or replace function public.tier1_training_complete(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_route'), 'documents') <> 'full' then
      exists (select 1 from public.tier1_training t
              where t.tutor_id = p_tutor and t.module = 7 and t.result in ('complete', 'pass') and t.conduct_accepted_at is not null)
    else
      not exists (
        select 1 from public.tier1_modules m
        where not exists (select 1 from public.tier1_training t
                          where t.tutor_id = p_tutor and t.module = m.module and t.result in ('complete', 'pass')))
  end;
$$;

-- Verifies, with no test, every subject where the tutor has an admin-checked record of at least the minimum, once Module 7 and the code of
-- conduct are done. Documents route only; returns how many subjects it verified. Called by the admin check and by the Module 7 check.
create or replace function public.tier1_grant_documents(p_tutor uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_route text := coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_route'), 'documents');
  v_min numeric := coalesce((select (setting_value #>> '{}')::numeric from public.system_settings where setting_key = 'tier1_min_subject_pct'), 70);
  v_wide numeric := coalesce((select (setting_value #>> '{}')::numeric from public.system_settings where setting_key = 'tier1_documents_wide_mark_pct'), 80);
  v_narrow text := coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_documents_narrow_max_grade'), 'Grade 10');
  v_cap integer := nullif(regexp_replace(coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_documents_narrow_max_grade'), 'Grade 10'), '\D', '', 'g'), '')::integer;
  r record;
  n integer := 0;
begin
  if v_route = 'full' or not public.is_tutor(p_tutor) or not public.tier1_training_complete(p_tutor) then
    return 0;
  end if;
  for r in
    select a.subject_name, max(a.mark_pct) as best
    from public.tier1_academic_records a
    join public.tier1_subjects s on s.subject_name = a.subject_name and s.status <> 'closed'
    where a.tutor_id = p_tutor and a.status = 'verified' and a.mark_pct >= v_min
    group by a.subject_name
  loop
    -- A subject that is already verified (by the old self-mark, an admin, or an earlier grant) is left exactly as it is.
    if exists (select 1 from public.tutor_subject_competencies c
               where c.tutor_id = p_tutor and lower(c.subject_name) = lower(r.subject_name) and c.verification_status = 'verified') then
      continue;
    end if;
    perform public.tier1_grant_subject(p_tutor, r.subject_name);
    n := n + 1;
    if r.best < v_wide and v_cap is not null then
      update public.tutor_subject_competencies c
      set max_grade_level = case when coalesce(nullif(regexp_replace(c.max_grade_level, '\D', '', 'g'), '')::integer, v_cap) > v_cap then v_narrow else c.max_grade_level end,
          min_grade_level = case when coalesce(nullif(regexp_replace(c.min_grade_level, '\D', '', 'g'), '')::integer, v_cap) > v_cap then v_narrow else c.min_grade_level end
      where c.tutor_id = p_tutor and lower(c.subject_name) = lower(r.subject_name);
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.tier1_grant_documents(uuid) from public, anon, authenticated, service_role;

create or replace function public.admin_check_tier1_record(p_id uuid, p_verdict text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tier1_academic_records%rowtype;
  v_route text := coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_route'), 'documents');
  v_granted integer := 0;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_verdict not in ('verified', 'rejected') then
    raise exception 'Choose verified or rejected';
  end if;
  if p_verdict = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why it isn''t accepted (the tutor sees this)';
  end if;
  if p_verdict = 'verified' and v_route <> 'full' and length(btrim(coalesce(p_note, ''))) < 20 then
    raise exception 'Write down what you checked: the original document, that the name matches the ID, the subject, the mark and the year';
  end if;
  select * into v_row from public.tier1_academic_records where id = p_id;
  if not found then
    raise exception 'No such record';
  end if;
  update public.tier1_academic_records
  set status = p_verdict, checked_by = auth.uid(), checked_at = now(), check_note = nullif(btrim(p_note), '')
  where id = p_id;
  if p_verdict = 'verified' then
    v_granted := public.tier1_grant_documents(v_row.tutor_id);
  end if;
  perform public.log_admin_event('tier1_record_checked', 'tier1_academic_records', p_id,
    jsonb_build_object('verdict', p_verdict, 'subject', v_row.subject_name, 'mark_pct', v_row.mark_pct, 'subjects_verified', v_granted));
end;
$$;

-- Every answer must be right (training curriculum, Module 7). An optional "conduct": true in the answers records that the tutor agreed to the
-- tutor code of conduct (kept on the Module 7 row, never removed). The reply says how many were right, not which.
create or replace function public.tier1_submit_module_check(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_right int;
  v_ok boolean;
  v_agree boolean := lower(coalesce(p_answers ->> 'conduct', '')) = 'true';
  v_accepted boolean := false;
  v_granted integer := 0;
begin
  if not public.is_tutor(auth.uid()) then
    raise exception 'Only tutor accounts can use the Tier 1 route' using errcode = '42501';
  end if;
  select count(*) into v_total from public.tier1_scenarios;
  select count(*) into v_right from public.tier1_scenarios s
  where (p_answers ->> s.id::text) ~ '^[0-3]$' and (p_answers ->> s.id::text)::int = s.answer;
  v_ok := v_total > 0 and v_right = v_total;
  if v_ok then
    insert into public.tier1_training as tt (tutor_id, module, result, method, recorded_by, conduct_accepted_at)
    values (auth.uid(), 7, 'pass', 'scenario_check', auth.uid(), case when v_agree then now() end)
    on conflict (tutor_id, module) do update
      set result = 'pass', method = 'scenario_check', recorded_at = now(),
          conduct_accepted_at = coalesce(tt.conduct_accepted_at, excluded.conduct_accepted_at);
    select t.conduct_accepted_at is not null into v_accepted from public.tier1_training t where t.tutor_id = auth.uid() and t.module = 7;
    v_granted := public.tier1_grant_documents(auth.uid());
  end if;
  return jsonb_build_object('passed', v_ok, 'right', v_right, 'total', v_total,
                            'conduct_accepted', v_ok and coalesce(v_accepted, false), 'subjects_verified', v_granted);
end;
$$;

-- Where the caller stands in one subject. Same reply as before plus: route, safeguarding_done, conduct_accepted, subject_verified, min_pct.
-- In the documents route the test is not offered (can_start is false) and the reasons talk about the record and Module 7.
create or replace function public.tier1_status(p_subject text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tutor uuid := auth.uid();
  v_subject public.tier1_subjects%rowtype;
  v_route text := case when coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_route'), 'documents') = 'full' then 'full' else 'documents' end;
  v_min text := coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_min_subject_pct'), '70');
  v_academic jsonb;
  v_attempts jsonb;
  v_passed boolean;
  v_failed int;
  v_last_fail timestamptz;
  v_open uuid;
  v_can boolean := false;
  v_reason text;
  v_next timestamptz;
  v_academic_ok boolean;
  v_train_ok boolean;
  v_safe boolean;
  v_conduct boolean;
  v_verified boolean;
begin
  if not public.is_tutor(v_tutor) then
    raise exception 'Only tutor accounts can use the Tier 1 route' using errcode = '42501';
  end if;
  select * into v_subject from public.tier1_subjects where subject_name = p_subject;
  if not found then
    raise exception 'Unknown subject';
  end if;

  select to_jsonb(x) into v_academic from (
    select status, mark_pct, check_note, created_at from public.tier1_academic_records
    where tutor_id = v_tutor and subject_name = p_subject order by created_at desc limit 1) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'started_at', started_at, 'submitted_at', submitted_at,
           'status', status, 'total_score', total_score, 'diagnosis_score', diagnosis_score, 'passed', passed)
           order by started_at desc), '[]'::jsonb)
  into v_attempts from public.tier1_attempts where tutor_id = v_tutor and subject_name = p_subject;

  -- A test left open past its deadline counts as a failed attempt (otherwise abandoning one would skip the wait).
  select bool_or(passed),
         count(*) filter (where (status <> 'in_progress' or deadline_at <= now()) and not coalesce(passed, false)),
         max(coalesce(submitted_at, deadline_at)) filter (where (status <> 'in_progress' or deadline_at <= now()) and not coalesce(passed, false))
  into v_passed, v_failed, v_last_fail
  from public.tier1_attempts where tutor_id = v_tutor and subject_name = p_subject;

  select id into v_open from public.tier1_attempts
  where tutor_id = v_tutor and subject_name = p_subject and status = 'in_progress' and deadline_at > now();

  v_academic_ok := public.tier1_academic_ok(v_tutor, p_subject);
  v_train_ok := public.tier1_training_complete(v_tutor);
  select (t.result in ('complete', 'pass')), (t.conduct_accepted_at is not null) into v_safe, v_conduct
  from public.tier1_training t where t.tutor_id = v_tutor and t.module = 7;
  select exists (select 1 from public.tutor_subject_competencies c
                 where c.tutor_id = v_tutor and lower(c.subject_name) = lower(p_subject) and c.verification_status = 'verified') into v_verified;

  if v_subject.status = 'closed' then
    v_reason := 'The Tier 1 route isn''t open for this subject yet.';
  elsif v_route = 'documents' then
    if v_verified and v_academic_ok then
      v_reason := 'Your results are checked and this subject is verified on your profile.';
    elsif not v_academic_ok then
      v_reason := format('First, Tutorlage needs to check a record showing at least %s%% in %s.', v_min, p_subject);
    elsif not v_train_ok then
      v_reason := 'Next, finish Module 7 (safeguarding) and agree to the code of conduct.';
    else
      v_reason := 'Your checks are done. This subject will show as verified on your profile shortly.';
    end if;
  elsif coalesce(v_passed, false) then
    v_reason := 'You''ve passed this subject''s test.';
  elsif not v_academic_ok then
    v_reason := format('First, Tutorlage needs to check a record showing at least %s%% in %s.', v_min, p_subject);
  elsif not v_train_ok then
    v_reason := 'First, finish the training: all seven modules.';
  elsif v_open is not null then
    v_can := true;
    v_reason := 'You have a test in progress.';
  elsif v_failed >= 2 then
    v_reason := 'You''ve used your test and your one retake for this subject.';
  elsif v_failed = 1 and v_last_fail + make_interval(days => v_subject.retake_wait_days) > now() then
    v_next := v_last_fail + make_interval(days => v_subject.retake_wait_days);
    v_reason := 'You can retake the test from the date shown.';
  else
    v_can := true;
  end if;

  return jsonb_build_object(
    'subject', p_subject,
    'subject_status', v_subject.status,
    'rules', jsonb_build_object('items', 8, 'marks', 16, 'pass_total', v_subject.pass_total,
                                'pass_diagnosis', v_subject.pass_diagnosis, 'minutes', v_subject.time_limit_minutes,
                                'retake_wait_days', v_subject.retake_wait_days),
    'academic', v_academic,
    'academic_ok', v_academic_ok,
    'training_complete', v_train_ok,
    'attempts', v_attempts,
    'passed', coalesce(v_passed, false),
    'can_start', v_can,
    'reason', v_reason,
    'next_retake_at', v_next,
    'open_attempt', v_open,
    'route', v_route,
    'safeguarding_done', coalesce(v_safe, false),
    'conduct_accepted', coalesce(v_conduct, false),
    'subject_verified', v_verified,
    'min_pct', v_min::numeric
  );
end;
$$;
