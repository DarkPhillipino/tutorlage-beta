-- 18 Nov 2026, new MUST item from the CEO (via the PM): qualified teachers and education students do not have to prove subject competence one subject at a time; their teaching
-- qualification (or proof they are studying to be a teacher) already is that proof. Written and proven rolled back, NOT applied: waits for the PM's apply line.
--
-- WHAT THE SYSTEM ALREADY KNEW: credential_definitions / tutor_credentials (an admin records a credential against a document; it already sets the tutor's level), the document types
-- teaching_qualification, sace_certificate, practicum_letter, university_transcript and proof_of_experience, and the experienced/beginner choice (not a proof of anything). Nothing said "this credential
-- proves subject competence", and there was no credential for a student teacher who has not finished a practicum yet.
-- WHAT THIS ADDS (all additive):
--   1. credential_definitions.proves_subject_competence (boolean, default false): DATA, like the levels. True for the teaching credentials that exist (SACE-registered teacher, teaching degree or PGCE
--      with 0, 2, 3 or 4 years, SACE FET subject teacher, head of department / subject head, student teacher with a completed practicum) and for ONE NEW credential,
--      'student_teacher_enrolled' ("Student teacher enrolled in a B.Ed or PGCE"), recorded against proof of enrolment (an academic record). Its level is 1A, the level every tutor starts at, so it changes
--      nobody's level; the Levels screen can change it.
--   2. admin_approve_subjects_on_credential(tutor, credential): ONE button for a verification officer or super admin. It needs a credential an admin has already recorded as verified, that proves subject
--      competence, still inside its recency window, with a document that belongs to the tutor and has itself been marked verified: a typed claim alone never approves anything. It then verifies every
--      PENDING (or under review) subject claim of that tutor, writes one review row per claim with the note "Teaching credential verified: <credential>" and one audit event per claim. It never touches a
--      rejected claim or one already verified, and the checklist route (admin_review_tutor_subject) stays exactly as it is for everybody else. No ceilings by degree: whatever subjects and grades the tutor claimed.
--   3. subject_approval_blocker(tutor): ONE place for "may a subject be approved for this tutor yet?" (returns the refusal sentence, or null). It returns null today, so nothing changes. BOTH approval routes
--      (the checklist and the credential button) call it, so item 7 (Module 7 before a subject can be approved), when the PM releases it, is one change to this one function and the teacher route obeys it too.
-- Rollback: Drake/programmer/rollbacks/20261118130000_teaching_credential_approves_subjects_ROLLBACK.sql.

alter table public.credential_definitions add column if not exists proves_subject_competence boolean not null default false;

update public.credential_definitions set proves_subject_competence = true
 where code in ('sace_registered_teacher', 'sace_fet_subject_teacher', 'teaching_degree', 'teaching_degree_2y', 'teaching_degree_3y', 'teaching_degree_4y', 'subject_leader', 'practicum_complete');

insert into public.credential_definitions (code, label, entry_sub_tier_id, recency_years, description, proves_subject_competence)
values ('student_teacher_enrolled', 'Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)', '1A', null,
        'Studying to be a teacher (B.Ed, PGCE or similar), shown by proof of enrolment or an academic record. It starts at level 1A, the level every tutor starts at, so it does not change anyone''s level; it lets an admin approve the claimed subjects without the per-subject checklist.', true)
on conflict (code) do nothing;

-- one place for "may a subject be approved yet?"
create or replace function public.subject_approval_blocker(p_tutor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select null::text;
$$;
revoke all on function public.subject_approval_blocker(uuid) from public, anon, authenticated, service_role;

-- the checklist route asks it first (it answers null today, so nothing changes)
do $m$
declare
  v_def text;
  v_new text;
  v_old constant text := E'  if p_decision = ''approve'' then\n';
  v_add constant text := E'  if p_decision = ''approve'' then\n'
    || E'    if public.subject_approval_blocker(c.tutor_id) is not null then\n'
    || E'      raise exception ''%'', public.subject_approval_blocker(c.tutor_id);\n'
    || E'    end if;\n';
begin
  v_def := pg_get_functiondef('public.admin_review_tutor_subject(uuid, text, text, uuid[])'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'admin_review_tutor_subject: expected exactly one approve branch; nothing changed';
  end if;
  v_new := replace(v_def, v_old, v_add);
  if v_new = v_def then raise exception 'admin_review_tutor_subject: nothing changed'; end if;
  execute v_new;
end
$m$;

create or replace function public.admin_approve_subjects_on_credential(p_tutor uuid, p_credential uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cred record;
  v_blocker text;
  c record;
  v_note text;
  v_ids uuid[] := '{}';
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can approve subjects' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;
  v_blocker := public.subject_approval_blocker(p_tutor);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  select tc.id, tc.credential_code, d.label, tc.obtained_on, doc.document_type::text as doc_type into v_cred
  from public.tutor_credentials tc
  join public.credential_definitions d on d.code = tc.credential_code
  join public.tutor_verification_documents doc on doc.id = tc.document_id and doc.tutor_id = tc.tutor_id
  where tc.tutor_id = p_tutor
    and (p_credential is null or tc.id = p_credential)
    and tc.status = 'verified'
    and d.proves_subject_competence
    and doc.status = 'verified'
    and doc.document_type::text in ('teaching_qualification', 'sace_certificate', 'practicum_letter', 'university_transcript', 'proof_of_experience')
    and (d.recency_years is null or tc.obtained_on is null or tc.obtained_on >= (current_date - make_interval(years => d.recency_years))::date)
  order by tc.verified_at desc nulls last
  limit 1;
  if not found then
    raise exception 'This tutor has no verified teaching credential with a verified document. Record the credential on the tutor''s page first, or use the checklist for each subject.';
  end if;

  v_note := 'Teaching credential verified: ' || v_cred.label || ' (' || replace(v_cred.doc_type, '_', ' ') || ')';
  for c in
    select s.id, s.subject_name, s.curriculum::text as curriculum
    from public.tutor_subject_competencies s
    where s.tutor_id = p_tutor and (s.verification_status is null or s.verification_status::text in ('pending', 'under_review'))
    order by s.created_at
    for update
  loop
    update public.tutor_subject_competencies set verification_status = 'verified', updated_at = now() where id = c.id;
    insert into public.tutor_subject_reviews (competency_id, reviewed_by, reviewed_at, review_note, criteria_met)
    values (c.id, auth.uid(), now(), v_note, '{}')
    on conflict (competency_id) do update
      set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, review_note = excluded.review_note, criteria_met = excluded.criteria_met;
    perform public.log_admin_event('tutor_approved', 'tutor_subject_competencies', c.id,
      jsonb_build_object('kind', 'subject_approved_on_credential', 'tutor_id', p_tutor, 'subject', c.subject_name, 'curriculum', c.curriculum,
                         'credential', v_cred.credential_code, 'credential_row', v_cred.id, 'note', v_note));
    v_ids := v_ids || c.id;
  end loop;
  return jsonb_build_object('approved', coalesce(array_length(v_ids, 1), 0), 'credential', v_cred.label, 'subject_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.admin_approve_subjects_on_credential(uuid, uuid) from public, anon;
grant execute on function public.admin_approve_subjects_on_credential(uuid, uuid) to authenticated;
