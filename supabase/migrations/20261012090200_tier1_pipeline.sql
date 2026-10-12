-- 2026-10-09, phase 2: the Tier 1 tutor pipeline (master backlog item 7; the CEO, 9 Oct: "build the tier 1 tutor
-- pipeline"). NOT applied: no database changes until Mon 12 Oct (CEO). Apply after 20261012090000 (audit
-- actions) and 20261012090100 (school results, which adds log_admin_event); then 20261012090300 seeds the test
-- items. Tested in a rolled-back transaction: supabase/tests/tier1_pipeline.sql.
--
-- The design is the educator's (Drake/educator/competency-framework.md, training-curriculum.md, item-bank/):
-- for each subject, three gates before a tutor without a teaching qualification may offer it:
--   1. at least 70% in the subject, shown on an uploaded matric or university record that an admin checks;
--   2. the training: self-paced Modules 1, 3, 4 and 6; Module 7 (safeguarding) with a scenario check that needs
--      every answer right; live Modules 2 and 5, signed off by a trainer (recorded by an admin);
--   3. the diagnostic test: 8 items, a diagnosis and a correction question each (16 marks), 30 minutes, graded
--      here so the keys never reach a browser, options shuffled per attempt, answers kept per attempt for the
--      trial's item analysis. Pass: at least 12/16 and at least 6 of the 8 diagnoses (provisional). One retake,
--      14 days after a failed attempt.
-- Passing makes the tutor's competency in that subject "verified". The items are designed, not validated, so
-- every subject starts in "evidence_gathering" (the protocol's word); nothing may describe the test as validated.
--
-- Also here, 7as: while `require_subject_verification` is true, a tutor can't mark their own subject verified
-- (today the site writes 'verified' itself). It's false during test phase 1, so nothing changes for testers.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Settings
insert into public.system_settings (setting_key, setting_value, description) values
  ('tier1_min_subject_pct', '70'::jsonb,
   'Minimum mark (%) in a subject for the Tier 1 route (competency framework).'),
  ('require_subject_verification', 'false'::jsonb,
   'When true, tutors can''t mark their own subjects verified: Tier 1 (or an admin) does it (7as). False during test phase 1; switch on for phase 2.')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Subjects and their test rules
create table if not exists public.tier1_subjects (
  subject_name text primary key,
  status text not null default 'evidence_gathering' check (status in ('closed', 'evidence_gathering', 'validated')),
  pass_total smallint not null default 12 check (pass_total between 1 and 16),
  pass_diagnosis smallint not null default 6 check (pass_diagnosis between 0 and 8),
  time_limit_minutes smallint not null default 30 check (time_limit_minutes between 5 and 120),
  retake_wait_days smallint not null default 14 check (retake_wait_days >= 0),
  updated_at timestamptz not null default now()
);
insert into public.tier1_subjects (subject_name) values
  ('Mathematics'), ('Mathematical Literacy'), ('Physical Sciences'), ('Life Sciences'), ('Accounting'),
  ('Business Studies'), ('Economics'), ('Life Orientation'), ('English Home Language'),
  ('English First Additional Language'), ('Afrikaans Home Language'), ('Afrikaans First Additional Language')
on conflict (subject_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Test items. Keys never leave the database: no client role can read this table.
create table if not exists public.tier1_items (
  id text primary key,
  subject_name text not null references public.tier1_subjects(subject_name),
  form text not null default 'A',
  position smallint not null,
  title text not null,
  grade_band text,
  stem text not null,
  q1_options text[] not null check (array_length(q1_options, 1) = 4),
  q1_key smallint not null check (q1_key between 0 and 3),
  q2_options text[] not null check (array_length(q2_options, 1) = 4),
  q2_key smallint not null check (q2_key between 0 and 3),
  active boolean not null default true
);

-- ---------------------------------------------------------------------------------------------------------
-- 4. Gate 1: academic records (files in the existing private 'tutor-documents' bucket, tutor's own folder)
create table if not exists public.tier1_academic_records (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  subject_name text not null references public.tier1_subjects(subject_name),
  mark_pct numeric(5, 2) not null check (mark_pct between 0 and 100),
  source text not null check (source in ('matric', 'university', 'other')),
  document_path text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz,
  check_note text,
  created_at timestamptz not null default now()
);
create index if not exists tier1_academic_records_tutor on public.tier1_academic_records (tutor_id, subject_name);

-- ---------------------------------------------------------------------------------------------------------
-- 5. Gate 2: training
create table if not exists public.tier1_modules (
  module smallint primary key check (module between 1 and 7),
  title text not null,
  kind text not null check (kind in ('self_paced', 'live')),
  needs_check boolean not null default false,
  summary text not null,
  content text not null
);

-- Module 7's scenario check. Keys never leave the database.
create table if not exists public.tier1_scenarios (
  id smallint primary key,
  prompt text not null,
  options text[] not null check (array_length(options, 1) = 4),
  answer smallint not null check (answer between 0 and 3)
);

create table if not exists public.tier1_training (
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  module smallint not null references public.tier1_modules(module),
  result text not null check (result in ('complete', 'pass', 'not_yet')),
  method text not null check (method in ('self_paced', 'scenario_check', 'trainer_signoff')),
  trainer_name text,
  missing_items text,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (tutor_id, module)
);

-- ---------------------------------------------------------------------------------------------------------
-- 6. Gate 3: test attempts. option_orders[i] holds the original option index shown at each position.
create table if not exists public.tier1_attempts (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  subject_name text not null references public.tier1_subjects(subject_name),
  form text not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  item_ids text[] not null,
  option_orders jsonb not null,
  answers jsonb,
  diagnosis_score smallint,
  correction_score smallint,
  total_score smallint,
  passed boolean,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired'))
);
create index if not exists tier1_attempts_tutor on public.tier1_attempts (tutor_id, subject_name, started_at desc);
create unique index if not exists tier1_attempts_one_open on public.tier1_attempts (tutor_id, subject_name)
  where status = 'in_progress';

-- ---------------------------------------------------------------------------------------------------------
-- 7. Access
alter table public.tier1_subjects enable row level security;
alter table public.tier1_items enable row level security;
alter table public.tier1_academic_records enable row level security;
alter table public.tier1_modules enable row level security;
alter table public.tier1_scenarios enable row level security;
alter table public.tier1_training enable row level security;
alter table public.tier1_attempts enable row level security;

revoke all on public.tier1_subjects, public.tier1_items, public.tier1_academic_records, public.tier1_modules,
  public.tier1_scenarios, public.tier1_training, public.tier1_attempts from anon, authenticated;

grant select on public.tier1_subjects, public.tier1_modules to authenticated;
drop policy if exists "Signed-in users read Tier 1 subjects" on public.tier1_subjects;
create policy "Signed-in users read Tier 1 subjects" on public.tier1_subjects for select to authenticated using (true);
drop policy if exists "Signed-in users read Tier 1 modules" on public.tier1_modules;
create policy "Signed-in users read Tier 1 modules" on public.tier1_modules for select to authenticated using (true);

-- Items (with keys) and scenarios (with answers): admins only.
grant select on public.tier1_items, public.tier1_scenarios to authenticated;
drop policy if exists "Admins read Tier 1 items" on public.tier1_items;
create policy "Admins read Tier 1 items" on public.tier1_items for select to authenticated using (public.is_active_admin());
drop policy if exists "Admins read Tier 1 scenarios" on public.tier1_scenarios;
create policy "Admins read Tier 1 scenarios" on public.tier1_scenarios for select to authenticated using (public.is_active_admin());

grant select on public.tier1_academic_records, public.tier1_training to authenticated;
drop policy if exists "Tutor or admin reads Tier 1 academic records" on public.tier1_academic_records;
create policy "Tutor or admin reads Tier 1 academic records" on public.tier1_academic_records for select to authenticated
  using (tutor_id = auth.uid() or public.is_active_admin());
drop policy if exists "Tutor or admin reads Tier 1 training" on public.tier1_training;
create policy "Tutor or admin reads Tier 1 training" on public.tier1_training for select to authenticated
  using (tutor_id = auth.uid() or public.is_active_admin());

-- Attempts: tutors see their own summary (not the option orders or answers); admins see everything.
grant select (id, tutor_id, subject_name, form, started_at, deadline_at, submitted_at, diagnosis_score,
              correction_score, total_score, passed, status)
  on public.tier1_attempts to authenticated;
drop policy if exists "Tutor or admin reads Tier 1 attempts" on public.tier1_attempts;
create policy "Tutor or admin reads Tier 1 attempts" on public.tier1_attempts for select to authenticated
  using (tutor_id = auth.uid() or public.is_active_admin());
-- Admins also need the answers for item analysis; they read them through admin_tier1_item_analysis().

-- ---------------------------------------------------------------------------------------------------------
-- 8. Helpers
create or replace function public.is_tutor(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tutor_profiles where id = p_profile);
$$;
revoke all on function public.is_tutor(uuid) from public, anon, authenticated;

create or replace function public.tier1_training_complete(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.tier1_modules m
    where not exists (select 1 from public.tier1_training t
                      where t.tutor_id = p_tutor and t.module = m.module and t.result in ('complete', 'pass'))
  );
$$;
revoke all on function public.tier1_training_complete(uuid) from public, anon, authenticated;

create or replace function public.tier1_academic_ok(p_tutor uuid, p_subject text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tier1_academic_records a
    where a.tutor_id = p_tutor and a.subject_name = p_subject and a.status = 'verified'
      and a.mark_pct >= coalesce((select (setting_value #>> '{}')::numeric from public.system_settings
                                  where setting_key = 'tier1_min_subject_pct'), 70)
  );
$$;
revoke all on function public.tier1_academic_ok(uuid, text) from public, anon, authenticated;

-- Passing makes the subject verified on the tutor's profile: an existing row for the subject keeps its grade
-- range; otherwise Grade 8–12 (CAPS), the range phase 1 uses (an educator/CEO decision to confirm).
create or replace function public.tier1_grant_subject(p_tutor uuid, p_subject text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tutor_subject_competencies
  set verification_status = 'verified', updated_at = now()
  where tutor_id = p_tutor and lower(subject_name) = lower(p_subject);
  if not found then
    insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (p_tutor, p_subject, 'caps', 'Grade 8', 'Grade 12', 'verified');
  end if;
end;
$$;
revoke all on function public.tier1_grant_subject(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Gate 1 functions
create or replace function public.tier1_submit_academic_record(p_subject text, p_mark_pct numeric, p_source text, p_document_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_tutor(auth.uid()) then
    raise exception 'Only tutor accounts can use the Tier 1 route' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tier1_subjects where subject_name = p_subject and status <> 'closed') then
    raise exception 'The Tier 1 route isn''t open for that subject';
  end if;
  if p_mark_pct is null or p_mark_pct < 0 or p_mark_pct > 100 then
    raise exception 'Enter your mark as a percentage (0 to 100)';
  end if;
  if p_source not in ('matric', 'university', 'other') then
    raise exception 'Say where the mark comes from';
  end if;
  if p_document_path is null or split_part(p_document_path, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects where bucket_id = 'tutor-documents' and name = p_document_path) then
    raise exception 'Upload your results document first';
  end if;
  insert into public.tier1_academic_records (tutor_id, subject_name, mark_pct, source, document_path)
  values (auth.uid(), p_subject, p_mark_pct, p_source, p_document_path)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_check_tier1_record(p_id uuid, p_verdict text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tier1_academic_records%rowtype;
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
  select * into v_row from public.tier1_academic_records where id = p_id;
  if not found then
    raise exception 'No such record';
  end if;
  update public.tier1_academic_records
  set status = p_verdict, checked_by = auth.uid(), checked_at = now(), check_note = nullif(btrim(p_note), '')
  where id = p_id;
  perform public.log_admin_event('tier1_record_checked', 'tier1_academic_records', p_id,
    jsonb_build_object('verdict', p_verdict, 'subject', v_row.subject_name, 'mark_pct', v_row.mark_pct));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 10. Gate 2 functions
create or replace function public.tier1_complete_module(p_module smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mod public.tier1_modules%rowtype;
begin
  if not public.is_tutor(auth.uid()) then
    raise exception 'Only tutor accounts can use the Tier 1 route' using errcode = '42501';
  end if;
  select * into v_mod from public.tier1_modules where module = p_module;
  if not found then
    raise exception 'No such module';
  end if;
  if v_mod.kind <> 'self_paced' or v_mod.needs_check then
    raise exception 'This module is completed with a trainer or a check, not by marking it read';
  end if;
  insert into public.tier1_training (tutor_id, module, result, method, recorded_by)
  values (auth.uid(), p_module, 'complete', 'self_paced', auth.uid())
  on conflict (tutor_id, module) do nothing;
end;
$$;

-- The scenarios, without their answers.
create or replace function public.tier1_module_check_questions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'prompt', prompt, 'options', to_jsonb(options)) order by id), '[]'::jsonb)
  from public.tier1_scenarios;
$$;

-- Every answer must be right (training curriculum, Module 7). The reply says how many were right, not which.
create or replace function public.tier1_submit_module_check(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_right int;
begin
  if not public.is_tutor(auth.uid()) then
    raise exception 'Only tutor accounts can use the Tier 1 route' using errcode = '42501';
  end if;
  select count(*) into v_total from public.tier1_scenarios;
  select count(*) into v_right from public.tier1_scenarios s
  where (p_answers ->> s.id::text) ~ '^[0-3]$' and (p_answers ->> s.id::text)::int = s.answer;
  if v_total > 0 and v_right = v_total then
    insert into public.tier1_training (tutor_id, module, result, method, recorded_by)
    values (auth.uid(), 7, 'pass', 'scenario_check', auth.uid())
    on conflict (tutor_id, module) do update set result = 'pass', method = 'scenario_check', recorded_at = now();
  end if;
  return jsonb_build_object('passed', v_total > 0 and v_right = v_total, 'right', v_right, 'total', v_total);
end;
$$;

create or replace function public.admin_record_tier1_signoff(p_tutor uuid, p_module smallint, p_trainer_name text,
                                                             p_result text, p_missing_items text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tier1_modules where module = p_module and kind = 'live') then
    raise exception 'Only the live modules (2 and 5) are signed off by a trainer';
  end if;
  if not public.is_tutor(p_tutor) then
    raise exception 'That account isn''t a tutor';
  end if;
  if coalesce(btrim(p_trainer_name), '') = '' then
    raise exception 'Enter the trainer''s name';
  end if;
  if p_result not in ('pass', 'not_yet') then
    raise exception 'Choose pass or not yet';
  end if;
  if p_result = 'not_yet' and coalesce(btrim(p_missing_items), '') = '' then
    raise exception 'Say which checklist items are still missing';
  end if;
  insert into public.tier1_training (tutor_id, module, result, method, trainer_name, missing_items, recorded_by)
  values (p_tutor, p_module, p_result, 'trainer_signoff', btrim(p_trainer_name), nullif(btrim(p_missing_items), ''), auth.uid())
  on conflict (tutor_id, module) do update
    set result = excluded.result, method = excluded.method, trainer_name = excluded.trainer_name,
        missing_items = excluded.missing_items, recorded_by = excluded.recorded_by, recorded_at = now();
  perform public.log_admin_event('tier1_training_signed_off', 'tutor_profiles', p_tutor,
    jsonb_build_object('module', p_module, 'result', p_result, 'trainer', btrim(p_trainer_name)));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 11. Gate 3 functions
-- Where the caller stands in one subject, and whether they may start the test now.
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
  v_academic jsonb;
  v_attempts jsonb;
  v_passed boolean;
  v_failed int;
  v_last_fail timestamptz;
  v_open uuid;
  v_can boolean := false;
  v_reason text;
  v_next timestamptz;
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

  if v_subject.status = 'closed' then
    v_reason := 'The Tier 1 route isn''t open for this subject yet.';
  elsif coalesce(v_passed, false) then
    v_reason := 'You''ve passed this subject''s test.';
  elsif not public.tier1_academic_ok(v_tutor, p_subject) then
    v_reason := format('First, Tutorlage needs to check a record showing at least %s%% in %s.',
      coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'tier1_min_subject_pct'), '70'), p_subject);
  elsif not public.tier1_training_complete(v_tutor) then
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
    'academic_ok', public.tier1_academic_ok(v_tutor, p_subject),
    'training_complete', public.tier1_training_complete(v_tutor),
    'attempts', v_attempts,
    'passed', coalesce(v_passed, false),
    'can_start', v_can,
    'reason', v_reason,
    'next_retake_at', v_next,
    'open_attempt', v_open
  );
end;
$$;

-- Starts (or resumes) the test. Returns the items in a random order, each question's options shuffled, and
-- never the keys.
create or replace function public.tier1_start_test(p_subject text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid := auth.uid();
  v_status jsonb;
  v_subject public.tier1_subjects%rowtype;
  v_attempt public.tier1_attempts%rowtype;
  v_ids text[];
  v_orders jsonb := '{}'::jsonb;
  v_id text;
  v_items jsonb := '[]'::jsonb;
  it public.tier1_items%rowtype;
  o1 int[];
  o2 int[];
begin
  v_status := public.tier1_status(p_subject);
  if not (v_status ->> 'can_start')::boolean then
    raise exception '%', coalesce(v_status ->> 'reason', 'You can''t start this test now');
  end if;
  select * into v_subject from public.tier1_subjects where subject_name = p_subject;

  -- Expire anything left open past its deadline.
  update public.tier1_attempts set status = 'expired', passed = false, total_score = coalesce(total_score, 0)
  where tutor_id = v_tutor and subject_name = p_subject and status = 'in_progress' and deadline_at <= now();

  select * into v_attempt from public.tier1_attempts
  where tutor_id = v_tutor and subject_name = p_subject and status = 'in_progress';

  if not found then
    select array_agg(id order by random()) into v_ids
    from public.tier1_items where subject_name = p_subject and form = 'A' and active;
    if v_ids is null or array_length(v_ids, 1) <> 8 then
      raise exception 'This subject''s test isn''t ready (it needs 8 active items)';
    end if;
    foreach v_id in array v_ids loop
      select array_agg(g order by random()) into o1 from generate_series(0, 3) g;
      select array_agg(g order by random()) into o2 from generate_series(0, 3) g;
      v_orders := v_orders || jsonb_build_object(v_id, jsonb_build_object('q1', to_jsonb(o1), 'q2', to_jsonb(o2)));
    end loop;
    insert into public.tier1_attempts (tutor_id, subject_name, form, deadline_at, item_ids, option_orders)
    values (v_tutor, p_subject, 'A', now() + make_interval(mins => v_subject.time_limit_minutes), v_ids, v_orders)
    returning * into v_attempt;
  end if;

  foreach v_id in array v_attempt.item_ids loop
    select * into it from public.tier1_items where id = v_id;
    o1 := array(select e::int from jsonb_array_elements_text(v_attempt.option_orders -> v_id -> 'q1') with ordinality as x(e, n) order by n);
    o2 := array(select e::int from jsonb_array_elements_text(v_attempt.option_orders -> v_id -> 'q2') with ordinality as x(e, n) order by n);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', it.id,
      'title', it.title,
      'grade_band', it.grade_band,
      'stem', it.stem,
      'q1', to_jsonb(array[it.q1_options[o1[1] + 1], it.q1_options[o1[2] + 1], it.q1_options[o1[3] + 1], it.q1_options[o1[4] + 1]]),
      'q2', to_jsonb(array[it.q2_options[o2[1] + 1], it.q2_options[o2[2] + 1], it.q2_options[o2[3] + 1], it.q2_options[o2[4] + 1]])
    ));
  end loop;

  return jsonb_build_object('attempt_id', v_attempt.id, 'subject', p_subject, 'deadline_at', v_attempt.deadline_at,
                            'items', v_items);
end;
$$;

-- Grades on the server. p_answers: { "<item id>": { "q1": <shown position 0-3>, "q2": <shown position 0-3> } }.
-- A submission more than 2 minutes after the deadline is recorded as expired and doesn't pass.
create or replace function public.tier1_submit_test(p_attempt uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.tier1_attempts%rowtype;
  v_subject public.tier1_subjects%rowtype;
  it public.tier1_items%rowtype;
  v_id text;
  v_shown int;
  v_orig int;
  v_diag int := 0;
  v_corr int := 0;
  v_marked jsonb := '{}'::jsonb;
  v_q1_ok boolean;
  v_q2_ok boolean;
  v_late boolean;
  v_passed boolean;
begin
  select * into v_attempt from public.tier1_attempts where id = p_attempt for update;
  if not found or v_attempt.tutor_id <> auth.uid() then
    raise exception 'No such test' using errcode = '42501';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'This test has already been handed in';
  end if;
  select * into v_subject from public.tier1_subjects where subject_name = v_attempt.subject_name;
  v_late := now() > v_attempt.deadline_at + interval '2 minutes';

  foreach v_id in array v_attempt.item_ids loop
    select * into it from public.tier1_items where id = v_id;
    v_q1_ok := false;
    v_q2_ok := false;
    if (p_answers -> v_id ->> 'q1') ~ '^[0-3]$' then
      v_shown := (p_answers -> v_id ->> 'q1')::int;
      v_orig := (v_attempt.option_orders -> v_id -> 'q1' ->> v_shown)::int;
      v_q1_ok := v_orig = it.q1_key;
    end if;
    if (p_answers -> v_id ->> 'q2') ~ '^[0-3]$' then
      v_shown := (p_answers -> v_id ->> 'q2')::int;
      v_orig := (v_attempt.option_orders -> v_id -> 'q2' ->> v_shown)::int;
      v_q2_ok := v_orig = it.q2_key;
    end if;
    if v_q1_ok then v_diag := v_diag + 1; end if;
    if v_q2_ok then v_corr := v_corr + 1; end if;
    v_marked := v_marked || jsonb_build_object(v_id, jsonb_build_object(
      'q1', p_answers -> v_id -> 'q1', 'q2', p_answers -> v_id -> 'q2', 'q1_ok', v_q1_ok, 'q2_ok', v_q2_ok));
  end loop;

  v_passed := not v_late and (v_diag + v_corr) >= v_subject.pass_total and v_diag >= v_subject.pass_diagnosis;
  update public.tier1_attempts
  set submitted_at = now(), answers = v_marked, diagnosis_score = v_diag, correction_score = v_corr,
      total_score = v_diag + v_corr, passed = v_passed, status = case when v_late then 'expired' else 'submitted' end
  where id = p_attempt;

  if v_passed then
    perform public.tier1_grant_subject(v_attempt.tutor_id, v_attempt.subject_name);
    insert into public.notifications (profile_id, type, title, body)
    values (v_attempt.tutor_id, 'tier1_passed', format('You passed the %s test', v_attempt.subject_name),
            format('%s is now verified on your profile. Learners can be matched with you for it.', v_attempt.subject_name));
  end if;

  return jsonb_build_object('status', case when v_late then 'expired' else 'submitted' end,
    'diagnosis_score', v_diag, 'correction_score', v_corr, 'total_score', v_diag + v_corr,
    'passed', v_passed, 'pass_total', v_subject.pass_total, 'pass_diagnosis', v_subject.pass_diagnosis,
    'late', v_late);
end;
$$;

-- Item analysis for the trial (validation protocol, stage 2): per item, how often each question was right.
create or replace function public.admin_tier1_item_analysis(p_subject text)
returns table (item_id text, title text, attempts int, q1_right_pct numeric, q2_right_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
  select i.id, i.title, count(a.id)::int,
         round(100.0 * count(*) filter (where (a.answers -> i.id ->> 'q1_ok')::boolean) / nullif(count(a.id), 0), 1),
         round(100.0 * count(*) filter (where (a.answers -> i.id ->> 'q2_ok')::boolean) / nullif(count(a.id), 0), 1)
  from public.tier1_items i
  left join public.tier1_attempts a on a.subject_name = i.subject_name and a.status <> 'in_progress' and a.answers ? i.id
  where i.subject_name = p_subject
  group by i.id, i.title, i.position
  order by i.position;
end;
$$;

revoke all on function public.tier1_submit_academic_record(text, numeric, text, text) from public, anon;
revoke all on function public.admin_check_tier1_record(uuid, text, text) from public, anon;
revoke all on function public.tier1_complete_module(smallint) from public, anon;
revoke all on function public.tier1_module_check_questions() from public, anon;
revoke all on function public.tier1_submit_module_check(jsonb) from public, anon;
revoke all on function public.admin_record_tier1_signoff(uuid, smallint, text, text, text) from public, anon;
revoke all on function public.tier1_status(text) from public, anon;
revoke all on function public.tier1_start_test(text) from public, anon;
revoke all on function public.tier1_submit_test(uuid, jsonb) from public, anon;
revoke all on function public.admin_tier1_item_analysis(text) from public, anon;
grant execute on function public.tier1_submit_academic_record(text, numeric, text, text) to authenticated;
grant execute on function public.admin_check_tier1_record(uuid, text, text) to authenticated;
grant execute on function public.tier1_complete_module(smallint) to authenticated;
grant execute on function public.tier1_module_check_questions() to authenticated;
grant execute on function public.tier1_submit_module_check(jsonb) to authenticated;
grant execute on function public.admin_record_tier1_signoff(uuid, smallint, text, text, text) to authenticated;
grant execute on function public.tier1_status(text) to authenticated;
grant execute on function public.tier1_start_test(text) to authenticated;
grant execute on function public.tier1_submit_test(uuid, jsonb) to authenticated;
grant execute on function public.admin_tier1_item_analysis(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 12. 7as: a tutor can't mark their own subject verified once `require_subject_verification` is on.
create or replace function public.guard_tutor_subject_verification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  if not coalesce((select (setting_value #>> '{}')::boolean from public.system_settings
                   where setting_key = 'require_subject_verification'), false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
  elsif new.verification_status is distinct from old.verification_status then
    raise exception 'Only Tutorlage can verify a subject' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_tutor_subject_verification on public.tutor_subject_competencies;
create trigger guard_tutor_subject_verification before insert or update on public.tutor_subject_competencies
  for each row execute function public.guard_tutor_subject_verification();

-- ---------------------------------------------------------------------------------------------------------
-- 13. Training content: Modules 1–7 (educator, training-curriculum.md v1.1, rewritten for trainees) and the
-- Module 7 scenario check (educator, 9 Oct, from the code of conduct v2 and the safeguarding procedure v2).
insert into public.tier1_modules (module, title, kind, needs_check, summary, content) values
(1, 'The Tutorlage teaching philosophy', 'self_paced', false,
 'Your job is to help a learner understand, not to hand them the answer.',
 E'Your job is to make the learner understand the idea themselves. If you solve the problem for them, the homework gets done but the job has failed: the same gap will trip them up in the test.\n\nSo in every session:\n- Let the learner try first, while you watch where they hesitate.\n- Find out why they went wrong before you correct anything.\n- Check that they can do a similar problem on their own before you move on.\n\nNever do a learner''s marked work for them (homework, assignments, projects, tests or exams), even if they or a parent ask. Explain, use a similar example, and check their own attempt instead. This is part of the code of conduct you accept.'),
(2, 'Diagnosing a misconception before correcting it', 'live', false,
 'Live, with a trainer: ask, listen, name the gap, fix it, check.',
 E'This module is practised live with a Tutorlage trainer, who signs you off.\n\nA wrong answer almost always comes from a specific misunderstanding, not carelessness. Before correcting anything: ask the learner to explain their reasoning out loud, listen for where the logic breaks, and name that gap back to them. Then fix it, and check with a new problem.\n\nAsk – Listen – Name – Fix – Check.\n\nYour trainer will arrange the session with you.'),
(3, 'Structuring a session', 'self_paced', false,
 'A repeatable shape for every hour.',
 E'Use the same shape every time:\n1. Quick check-in: what are we working on, and where did you get stuck?\n2. Let the learner attempt it first, live, while you watch for where they hesitate.\n3. Work the sticking point, diagnosing before correcting (Module 2).\n4. Have the learner do a similar problem on their own, to check the fix landed, not just that they nodded along.\n5. A 30-second wrap-up naming what was learned.'),
(4, 'Communicating clearly', 'self_paced', false,
 'Plain words, real checks for understanding, the learner''s pace.',
 E'- Use plain language. If the subject needs a technical term, define it once, simply.\n- Check understanding by asking the learner to explain it back, not by asking "does that make sense?" (which almost always gets a "yes").\n- Match your pace to the learner, not to how fast you find the work.'),
(5, 'Handling a struggling or frustrated learner', 'live', false,
 'Live, with a trainer: smaller steps, earned encouragement, a reset when needed.',
 E'This module is practised live with a Tutorlage trainer, who signs you off.\n\nBreak the problem into a smaller step the learner can do, and build from there, instead of repeating the same explanation louder or slower. Make encouragement specific and earned ("you got the setup right; it''s just this one step"). If the learner is genuinely frustrated, it''s fine to pause and reset.'),
(6, 'Professionalism on Tutorlage', 'self_paced', false,
 'Punctuality, boundaries, honesty, and reporting problems properly.',
 E'- Be on time, and keep sessions to the booked time and subject.\n- If you don''t know an answer, say so honestly, then work it out together or follow up. Never present a guess as certain.\n- Report problems through Tutorlage instead of handling them informally: a technical problem (Report a problem on the session), anything about safety (safety@tutorlage.com).'),
(7, 'Safeguarding learners', 'self_paced', true,
 'Required before any session with a learner under 18. Ends with a short check: every answer must be right.',
 E'Many learners you teach will be children. These rules protect them, and you.\n\nBoundaries\n- Sessions happen online through the link on the Tutorlage session. Nobody else should join unless the parent asks.\n- No private contact with a learner under 18: no personal phone numbers, WhatsApp, social media or messaging apps. Contact goes through their parent or guardian, whose number Tutorlage gives you for the session.\n- If a learner contacts you privately, don''t reply privately: tell their parent and Tutorlage.\n- Never ask a learner to keep a secret, and no gifts, money, favours or meetings outside sessions.\n- Don''t record sessions or take photos or screenshots of a learner.\n\nIf a learner shows or sends something explicit\n- Don''t open it further, save, screenshot, forward or show it to anyone: storing or passing on a sexual image of a child can itself be a crime. End the session, note where and when it appeared, and report it to SAPS and to Tutorlage the same day.\n\nIf a learner tells you something worrying\n- If a child may be in immediate danger, call SAPS on 10111 (112 from a mobile) first. Childline (116) gives adults guidance too.\n- Listen calmly. Don''t promise to keep it secret: say you''ll need to tell someone who can help. Don''t investigate or question them further.\n- Write down what they said, in their words, and when.\n- Report it (a suspected sexual offence against a child to the police; domestic violence to a social worker or SAPS). You never need Tutorlage''s permission first.\n- Then tell Tutorlage''s safeguarding lead the same day: safety@tutorlage.com.')
on conflict (module) do update set title = excluded.title, kind = excluded.kind, needs_check = excluded.needs_check,
  summary = excluded.summary, content = excluded.content;

insert into public.tier1_scenarios (id, prompt, options, answer) values
(1, 'A 14-year-old learner asks at the end of a session: "Can I have your WhatsApp number, so I can ask you questions between sessions?" What do you do first?',
 array['Give your number, but tell them to use it only for school questions.',
       'Say no kindly, and explain that contact between sessions goes through their parent or guardian and Tutorlage.',
       'Give your number to the parent instead, without telling Tutorlage.',
       'Ignore the question and end the session.'], 1),
(2, 'During a session a learner tells you that someone at home hurts them, and asks you not to tell anyone. What do you do first?',
 array['Promise not to tell, so they keep trusting you.',
       'Ask them for the details so you can be sure before doing anything.',
       'Listen calmly, don''t promise to keep it secret, and tell them you''ll need to tell someone who can help.',
       'End the session and see whether it comes up again next time.'], 2),
(3, 'A learner sends an explicit image into the session chat. What do you do first?',
 array['Take a screenshot as evidence and email it to Tutorlage.',
       'Show it to the learner''s parent so they know what happened.',
       'Delete it and carry on with the session.',
       'Don''t open, save or forward it; end the session, note where and when it appeared, and report it to SAPS and Tutorlage the same day.'], 3),
(4, 'During a session a learner says someone is threatening them right now and they''re scared. What do you do first?',
 array['Call SAPS on 10111 (or 112 from a mobile) straight away.',
       'Email safety@tutorlage.com and wait for a reply.',
       'Message the learner''s parent and ask what they want you to do.',
       'Tell the learner to call you back when they feel safe.'], 0)
on conflict (id) do update set prompt = excluded.prompt, options = excluded.options, answer = excluded.answer;
