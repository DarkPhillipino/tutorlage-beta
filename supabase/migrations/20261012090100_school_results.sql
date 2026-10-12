-- 2026-10-09, phase 2: learners' school results (report cards and assessment marks), and the grade-uplift
-- figure they feed into tutor levels. NOT applied: the CEO said on 9 Oct there are no database changes
-- until Mon 12 Oct. Tested in a rolled-back transaction (supabase/tests/school_results.sql). Apply after
-- 20261012090000 (the audit actions).
--
-- The CEO, 9 Oct: "we need to add the ability for parents to add their students report cards and we should
-- prompt them to do if they do have one to give, if not prompt them to add every assesment conducted during
-- the period they were with their selected tutor." Asked when marks should count towards a tutor's level, the
-- CEO answered "After Tutorlage checks (Recommended)".
--
-- How it works:
-- - A parent or guardian (with active consent for the learner), or an adult learner for themselves, gives a
--   separate consent, then adds results: a report card's mark for a subject, or one test, assignment or exam.
--   Only subjects the learner has booked are accepted (privacy policy v4 §6: only what's needed).
-- - Each result starts "pending". An admin checks it against the uploaded document; only "verified" results
--   are used. A result with no document can't be verified, so it never counts.
-- - For each tutor who has taught the learner at least `uplift_min_sessions` completed sessions in a subject,
--   the learner's progress is the verified mark *during* that tutor's period minus the mark *before* it
--   (percentage points). It's written to student_academic_records, which fn_recalculate_tutor_tier already
--   reads (avg_grade_uplift_pct, qualified_uplift_students_count).
-- - Tutors see only the change, never the marks or documents (column grants below).
-- - The legacy academic_assessments_and_reports table and its trigger (from the original schema) are switched
--   off: any signed-in learner could write rows that fed student_academic_records directly. It has 0 rows.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Settings
insert into public.system_settings (setting_key, setting_value, description) values
  ('uplift_min_sessions', '3'::jsonb,
   'Completed sessions a tutor must have taught a learner in a subject before that learner''s school results count towards the tutor''s grade uplift (PM default, 9 Oct; the CEO can change it).'),
  ('school_results_consent_version', '"2026-10-09"'::jsonb,
   'Version of the consent text shown before a parent (or adult learner) first adds school results.')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- 2. An internal audit helper for functions that act for an admin.
create or replace function public.log_admin_event(p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, metadata)
  values (auth.uid(), p_action::public.audit_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public.log_admin_event(text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Tables
create table if not exists public.school_results_consents (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  consented_by uuid not null references public.profiles(id) on delete cascade,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table if not exists public.school_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject_name text not null,
  kind text not null check (kind in ('report_card', 'test', 'assignment', 'exam', 'other')),
  title text not null check (length(btrim(title)) between 1 and 120),
  assessed_on date not null,
  term smallint check (term between 1 and 4),
  mark numeric(7, 2) not null check (mark >= 0),
  out_of numeric(7, 2) not null check (out_of > 0),
  percent numeric(5, 1) generated always as (round(mark / out_of * 100, 1)) stored,
  document_path text,
  entered_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz,
  check_note text,
  created_at timestamptz not null default now(),
  constraint school_results_mark_within_out_of check (mark <= out_of)
);
create index if not exists school_results_student_subject on public.school_results (student_id, lower(subject_name));
create index if not exists school_results_pending on public.school_results (created_at) where status = 'pending';

alter table public.school_results enable row level security;
alter table public.school_results_consents enable row level security;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Who may manage a learner's results: an adult learner for themselves, or a guardian who can act for them
-- (adult, linked, consent not withdrawn).
create or replace function public.can_manage_school_results(p_learner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_learner is not null and (
    (auth.uid() = p_learner and public.is_adult(auth.uid()))
    or public.can_act_for_learner(p_learner)
  );
$$;

-- Storage paths are "<learner id>/<file>"; a folder that isn't a uuid never matches.
create or replace function public.can_manage_school_results_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.can_manage_school_results(p_folder::uuid)
    else false
  end;
$$;
revoke all on function public.can_manage_school_results(uuid) from public, anon;
revoke all on function public.can_manage_school_results_folder(text) from public, anon;
grant execute on function public.can_manage_school_results(uuid) to authenticated;
grant execute on function public.can_manage_school_results_folder(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Access: read through RLS; every write goes through the functions below.
revoke all on public.school_results from anon, authenticated;
revoke all on public.school_results_consents from anon, authenticated;
grant select on public.school_results to authenticated;
grant select on public.school_results_consents to authenticated;

drop policy if exists "Learner, guardian or admin reads school results" on public.school_results;
create policy "Learner, guardian or admin reads school results" on public.school_results
  for select to authenticated
  using (public.can_manage_school_results(student_id) or public.is_active_admin());

drop policy if exists "Learner, guardian or admin reads school results consent" on public.school_results_consents;
create policy "Learner, guardian or admin reads school results consent" on public.school_results_consents
  for select to authenticated
  using (public.can_manage_school_results(student_id) or public.is_active_admin());

-- ---------------------------------------------------------------------------------------------------------
-- 6. The private bucket for report cards and marked work (5 MB, PDF/JPG/PNG), one folder per learner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-results', 'school-results', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "School results: learner or guardian uploads" on storage.objects;
create policy "School results: learner or guardian uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'school-results' and public.can_manage_school_results_folder((storage.foldername(name))[1]));

drop policy if exists "School results: learner, guardian or admin reads" on storage.objects;
create policy "School results: learner, guardian or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'school-results'
         and (public.can_manage_school_results_folder((storage.foldername(name))[1]) or public.is_active_admin()));

drop policy if exists "School results: learner or guardian deletes" on storage.objects;
create policy "School results: learner or guardian deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'school-results' and public.can_manage_school_results_folder((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------------------------------------------
-- 7. The legacy assessments path is switched off, and student_academic_records is written only here.
drop trigger if exists trigger_sync_academic_record on public.academic_assessments_and_reports;
revoke insert, update, delete on public.academic_assessments_and_reports from authenticated;

create unique index if not exists student_academic_records_one_per_tutor
  on public.student_academic_records (student_id, tutor_id, subject_name);

-- Tutors (and learners) see the change, not the marks.
revoke select on public.student_academic_records from authenticated;
grant select (id, student_id, tutor_id, subject_name, uplift_delta_pct, updated_at)
  on public.student_academic_records to authenticated;
drop policy if exists "Guardians view their learners' progress" on public.student_academic_records;
create policy "Guardians view their learners' progress" on public.student_academic_records
  for select to authenticated using (public.can_act_for_learner(student_id));

-- ---------------------------------------------------------------------------------------------------------
-- 8. The marks used for progress. Only verified results count.
-- Before a tutor's period: the latest report card in the 12 months up to the first session; if none, the
-- average of tests, assignments and exams in the 90 days before it.
create or replace function public.school_result_pct_before(p_student uuid, p_subject text, p_start date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select avg(percent) from public.school_results r
      where r.student_id = p_student and lower(r.subject_name) = lower(p_subject) and r.status = 'verified'
        and r.kind = 'report_card'
        and r.assessed_on = (select max(assessed_on) from public.school_results x
                             where x.student_id = p_student and lower(x.subject_name) = lower(p_subject)
                               and x.status = 'verified' and x.kind = 'report_card'
                               and x.assessed_on <= p_start and x.assessed_on > p_start - 365)),
    (select avg(percent) from public.school_results r
      where r.student_id = p_student and lower(r.subject_name) = lower(p_subject) and r.status = 'verified'
        and r.kind <> 'report_card' and r.assessed_on <= p_start and r.assessed_on > p_start - 90)
  );
$$;

-- During it: the latest report card dated from 14 days after the first session to 90 days after the last;
-- if none, the average of every test, assignment and exam from the first session to 30 days after the last.
create or replace function public.school_result_pct_during(p_student uuid, p_subject text, p_first date, p_last date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select avg(percent) from public.school_results r
      where r.student_id = p_student and lower(r.subject_name) = lower(p_subject) and r.status = 'verified'
        and r.kind = 'report_card'
        and r.assessed_on = (select max(assessed_on) from public.school_results x
                             where x.student_id = p_student and lower(x.subject_name) = lower(p_subject)
                               and x.status = 'verified' and x.kind = 'report_card'
                               and x.assessed_on >= p_first + 14 and x.assessed_on <= p_last + 90)),
    (select avg(percent) from public.school_results r
      where r.student_id = p_student and lower(r.subject_name) = lower(p_subject) and r.status = 'verified'
        and r.kind <> 'report_card' and r.assessed_on > p_first and r.assessed_on <= p_last + 30)
  );
$$;

-- Rebuilds one learner's progress in one subject for every tutor who taught it, then recalculates those
-- tutors' levels.
create or replace function public.refresh_school_progress(p_student uuid, p_subject text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int := coalesce((select (setting_value #>> '{}')::int from public.system_settings
                         where setting_key = 'uplift_min_sessions'), 3);
  v_affected uuid[];
  t record;
  v_base numeric;
  v_cur numeric;
  v_tutor uuid;
begin
  if p_student is null or p_subject is null then
    return;
  end if;
  select coalesce(array_agg(distinct tutor_id) filter (where tutor_id is not null), '{}') into v_affected
  from public.student_academic_records
  where student_id = p_student and lower(subject_name) = lower(p_subject);

  delete from public.student_academic_records
  where student_id = p_student and lower(subject_name) = lower(p_subject);

  for t in
    select s.tutor_id, min(s.scheduled_start)::date as first_on, max(s.scheduled_start)::date as last_on,
           count(*) as n
    from public.sessions s
    join public.student_subject_enrollments e on e.id = s.enrollment_id
    where s.student_id = p_student and s.status = 'completed' and lower(e.subject_name) = lower(p_subject)
    group by s.tutor_id
  loop
    if t.n >= v_min then
      v_base := public.school_result_pct_before(p_student, p_subject, t.first_on);
      v_cur := public.school_result_pct_during(p_student, p_subject, t.first_on, t.last_on);
      if v_base is not null and v_cur is not null then
        -- uplift_delta_pct is generated: current_score_pct - baseline_score_pct.
        insert into public.student_academic_records
          (student_id, tutor_id, subject_name, baseline_score_pct, current_score_pct, updated_at)
        values (p_student, t.tutor_id, p_subject, round(v_base, 2), round(v_cur, 2), now());
      end if;
      v_affected := array_append(v_affected, t.tutor_id);
    end if;
  end loop;

  for v_tutor in select distinct u from unnest(v_affected) as u where u is not null loop
    perform public.fn_recalculate_tutor_tier(v_tutor);
  end loop;
end;
$$;
revoke all on function public.school_result_pct_before(uuid, text, date) from public, anon, authenticated;
revoke all on function public.school_result_pct_during(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.refresh_school_progress(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 9. What the site calls.
create or replace function public.give_school_results_consent(p_learner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := (select setting_value #>> '{}' from public.system_settings
                     where setting_key = 'school_results_consent_version');
begin
  if not public.can_manage_school_results(p_learner) then
    raise exception 'You can only add school results for yourself (18 or older) or a learner you''re the guardian of'
      using errcode = '42501';
  end if;
  insert into public.school_results_consents (student_id, consented_by, consent_version, consented_at, withdrawn_at)
  values (p_learner, auth.uid(), coalesce(v_version, 'unknown'), now(), null)
  on conflict (student_id) do update
    set consented_by = excluded.consented_by, consent_version = excluded.consent_version,
        consented_at = excluded.consented_at, withdrawn_at = null;
end;
$$;

create or replace function public.add_school_result(
  p_learner uuid, p_subject text, p_kind text, p_title text, p_assessed_on date, p_term smallint,
  p_mark numeric, p_out_of numeric, p_document_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_subject text;
begin
  if not public.can_manage_school_results(p_learner) then
    raise exception 'You can only add school results for yourself (18 or older) or a learner you''re the guardian of'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.school_results_consents
                 where student_id = p_learner and withdrawn_at is null) then
    raise exception 'Give consent for school results first';
  end if;
  -- Only subjects the learner has booked (data minimisation, privacy policy v4 §6).
  select subject_name into v_subject from public.student_subject_enrollments
  where student_id = p_learner and lower(subject_name) = lower(btrim(p_subject))
  limit 1;
  if v_subject is null then
    raise exception 'Add results only for a subject this learner has booked sessions in';
  end if;
  if p_kind is null or p_kind not in ('report_card', 'test', 'assignment', 'exam', 'other') then
    raise exception 'Choose what it is: a report card, test, assignment, exam or other';
  end if;
  if coalesce(btrim(p_title), '') = '' or length(btrim(p_title)) > 120 then
    raise exception 'Give it a short name, like "Term 2 report" or "Algebra test"';
  end if;
  if p_term is not null and p_term not between 1 and 4 then
    raise exception 'The term is 1, 2, 3 or 4';
  end if;
  if p_assessed_on is null or p_assessed_on > current_date or p_assessed_on < current_date - 730 then
    raise exception 'Enter the date of the report or assessment (within the last two years)';
  end if;
  if p_mark is null or p_out_of is null or p_out_of <= 0 or p_mark < 0 or p_mark > p_out_of then
    raise exception 'Enter the mark and what it was out of (the mark can''t be more than the total)';
  end if;
  if p_document_path is not null then
    if split_part(p_document_path, '/', 1) <> p_learner::text then
      raise exception 'That file belongs to someone else';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'school-results' and name = p_document_path) then
      raise exception 'Upload the file first';
    end if;
  end if;
  insert into public.school_results
    (student_id, subject_name, kind, title, assessed_on, term, mark, out_of, document_path, entered_by)
  values
    (p_learner, v_subject, p_kind, btrim(p_title), p_assessed_on, p_term, p_mark, p_out_of, p_document_path, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Returns the document path (if any) so the site can delete the file too.
create or replace function public.delete_school_result(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.school_results%rowtype;
begin
  select * into v_row from public.school_results where id = p_id;
  if not found or not public.can_manage_school_results(v_row.student_id) then
    raise exception 'No such result' using errcode = '42501';
  end if;
  delete from public.school_results where id = p_id;
  if v_row.status = 'verified' then
    perform public.refresh_school_progress(v_row.student_id, v_row.subject_name);
  end if;
  return v_row.document_path;
end;
$$;

-- Withdrawing consent deletes every result for the learner. Returns the document paths to delete.
create or replace function public.withdraw_school_results_consent(p_learner uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paths text[];
  v_subject text;
begin
  if not public.can_manage_school_results(p_learner) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.school_results_consents set withdrawn_at = now() where student_id = p_learner;
  select coalesce(array_agg(document_path) filter (where document_path is not null), '{}') into v_paths
  from public.school_results where student_id = p_learner;
  for v_subject in
    select distinct subject_name from public.school_results where student_id = p_learner and status = 'verified'
  loop
    delete from public.school_results where student_id = p_learner and subject_name = v_subject;
    perform public.refresh_school_progress(p_learner, v_subject);
  end loop;
  delete from public.school_results where student_id = p_learner;
  return v_paths;
end;
$$;

-- What to prompt for: each subject the learner has completed sessions in, with the dates that matter and
-- whether results exist from before and during tutoring (pending ones count here, so a parent isn't asked
-- twice).
create or replace function public.school_results_overview(p_learner uuid)
returns table (subject_name text, first_session_on date, last_session_on date, completed_sessions int,
               tutors int, has_before boolean, has_during boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_manage_school_results(p_learner) or public.is_active_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select e.subject_name::text,
         min(s.scheduled_start)::date,
         max(s.scheduled_start)::date,
         count(*)::int,
         count(distinct s.tutor_id)::int,
         exists (select 1 from public.school_results r
                 where r.student_id = p_learner and lower(r.subject_name) = lower(e.subject_name)
                   and r.status <> 'rejected' and r.assessed_on <= min(s.scheduled_start)::date),
         exists (select 1 from public.school_results r
                 where r.student_id = p_learner and lower(r.subject_name) = lower(e.subject_name)
                   and r.status <> 'rejected' and r.assessed_on > min(s.scheduled_start)::date)
  from public.sessions s
  join public.student_subject_enrollments e on e.id = s.enrollment_id
  where s.student_id = p_learner and s.status = 'completed'
  group by e.subject_name
  order by min(s.scheduled_start);
end;
$$;

-- The admin check (CEO: marks count only "After Tutorlage checks").
create or replace function public.admin_check_school_result(p_id uuid, p_verdict text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.school_results%rowtype;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_verdict not in ('verified', 'rejected') then
    raise exception 'Choose verified or rejected';
  end if;
  select * into v_row from public.school_results where id = p_id;
  if not found then
    raise exception 'No such result';
  end if;
  if p_verdict = 'verified' and v_row.document_path is null then
    raise exception 'A result can only be verified against a document';
  end if;
  if p_verdict = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why it isn''t accepted (the parent sees this)';
  end if;
  update public.school_results
  set status = p_verdict, checked_by = auth.uid(), checked_at = now(), check_note = nullif(btrim(p_note), '')
  where id = p_id;
  perform public.log_admin_event('school_result_checked', 'school_results', p_id,
    jsonb_build_object('verdict', p_verdict, 'previous_status', v_row.status));
  if p_verdict = 'verified' or v_row.status = 'verified' then
    perform public.refresh_school_progress(v_row.student_id, v_row.subject_name);
  end if;
end;
$$;

revoke all on function public.give_school_results_consent(uuid) from public, anon;
revoke all on function public.add_school_result(uuid, text, text, text, date, smallint, numeric, numeric, text) from public, anon;
revoke all on function public.delete_school_result(uuid) from public, anon;
revoke all on function public.withdraw_school_results_consent(uuid) from public, anon;
revoke all on function public.school_results_overview(uuid) from public, anon;
revoke all on function public.admin_check_school_result(uuid, text, text) from public, anon;
grant execute on function public.give_school_results_consent(uuid) to authenticated;
grant execute on function public.add_school_result(uuid, text, text, text, date, smallint, numeric, numeric, text) to authenticated;
grant execute on function public.delete_school_result(uuid) to authenticated;
grant execute on function public.withdraw_school_results_consent(uuid) to authenticated;
grant execute on function public.school_results_overview(uuid) to authenticated;
grant execute on function public.admin_check_school_result(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 10. On completion: recalculate (as before), refresh the learner's progress in that subject, and on the
-- third completed session with the same tutor in a subject, invite the learner's guardian (or the adult
-- learner) to add school results. The invitation is sent once per tutor and subject.
create or replace function public.trg_on_session_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_count int;
  v_first_name text;
  v_recipient uuid;
  v_guardians int := 0;
begin
  if new.status = 'completed' then
    perform public.fn_recalculate_tutor_tier(new.tutor_id);

    if old.status is distinct from 'completed' and new.enrollment_id is not null then
      select subject_name into v_subject from public.student_subject_enrollments where id = new.enrollment_id;
      if v_subject is not null then
        perform public.refresh_school_progress(new.student_id, v_subject);

        select count(*) into v_count
        from public.sessions s join public.student_subject_enrollments e on e.id = s.enrollment_id
        where s.student_id = new.student_id and s.tutor_id = new.tutor_id and s.status = 'completed'
          and lower(e.subject_name) = lower(v_subject);

        if v_count = 3 then
          select first_name into v_first_name from public.student_profiles where id = new.student_id;
          for v_recipient in
            select l.parent_id from public.parent_student_links l
            where l.student_id = new.student_id
              and public.has_active_guardian_consent(l.parent_id, new.student_id)
          loop
            v_guardians := v_guardians + 1;
            insert into public.notifications (profile_id, type, title, body, related_session_id)
            values (v_recipient, 'school_results_prompt', 'Add school results (optional)',
                    format('%s has had 3 %s sessions with the same tutor. If you have a report card or marked tests from this time, adding them shows %s''s progress. Open "Your learners" to add them.',
                           coalesce(v_first_name, 'Your learner'), v_subject, coalesce(v_first_name, 'their')),
                    new.id);
          end loop;
          if v_guardians = 0 and public.is_adult(new.student_id) then
            insert into public.notifications (profile_id, type, title, body, related_session_id)
            values (new.student_id, 'school_results_prompt', 'Add your school results (optional)',
                    format('You''ve had 3 %s sessions with the same tutor. If you have a report card or marked tests from this time, adding them shows your progress.', v_subject),
                    new.id);
          end if;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;
