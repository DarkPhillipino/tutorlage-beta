-- 2026-11-23, P4-4 (PM line 46, job M): a credential cannot be recorded without a linked, VERIFIED document of an allowed type; the screen can be told which credential a document suggests.
-- Until now admin_record_credential took the document as OPTIONAL, never looked at its status or kind, and stored the credential as verified at once (production had 0 such rows, so the gap was unused).
-- What this does (ADDITIVE except one replaced function whose old text is in Drake/programmer/backups/2026-11-23-p4-slice-a/ for the earlier version and in the migration 20261116200000 for this one):
--   1. NEW column credential_definitions.accepted_document_types (text[]): which kinds of document can prove each credential. It is DATA (the CEO's rule: levels and credential mapping are data), seeded below;
--      a credential with no list (a new one an admin adds) accepts any verified document except an ID, a police clearance and school results.
--   2. REPLACES admin_record_credential(tutor, code, obtained_on, document, note) with the SAME signature and rights: the document is required (admin_assigned stays the one exception and it has its own function,
--      admin_assign_tier, with a reason of 10 characters); it must be this tutor's, status VERIFIED, and of an accepted kind; a credential that expires (recency_years) needs the date it was obtained; no date in the future.
--   3. NEW admin_credential_suggestions(document): read only, verification officer or super admin: the credentials a document could prove (for the screen to suggest; the officer still chooses).
-- What stays human: whether the document really proves the credential. The function only refuses what the rules can see.
-- Rollback: Drake/programmer/rollbacks/20261123180000_p4_credentials_ROLLBACK.sql. Test: supabase/tests/p4_credentials.sql.

alter table public.credential_definitions add column if not exists accepted_document_types text[];

update public.credential_definitions set accepted_document_types = case code
  when 'student_teacher_enrolled' then array['teaching_qualification', 'university_transcript']
  when 'higher_certificate_education' then array['teaching_qualification', 'university_transcript']
  when 'practicum_complete' then array['practicum_letter']
  when 'sace_registered_teacher' then array['sace_certificate', 'teaching_qualification']
  when 'teaching_degree' then array['teaching_qualification', 'university_transcript']
  when 'teaching_degree_2y' then array['teaching_qualification', 'university_transcript', 'proof_of_experience']
  when 'teaching_degree_3y' then array['teaching_qualification', 'university_transcript', 'proof_of_experience']
  when 'teaching_degree_4y' then array['teaching_qualification', 'university_transcript', 'proof_of_experience']
  when 'sace_fet_subject_teacher' then array['sace_certificate', 'teaching_qualification', 'proof_of_experience']
  when 'subject_leader' then array['proof_of_experience']
  when 'exam_marker' then array['marking_appointment_letter']
  when 'exam_moderator_examiner' then array['marking_appointment_letter']
  else accepted_document_types end
where accepted_document_types is null and code <> 'admin_assigned';

create or replace function public.admin_record_credential(p_tutor uuid, p_code text, p_obtained_on date, p_document uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_entry varchar;
  v_recency integer;
  v_accepted text[];
  d record;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;
  select entry_sub_tier_id, recency_years, accepted_document_types into v_entry, v_recency, v_accepted from public.credential_definitions where code = p_code;
  if not found then
    raise exception 'No such credential';
  end if;
  if p_code = 'admin_assigned' or v_entry is null then
    raise exception 'To set a level for this tutor use "Assign a level"';
  end if;
  -- P4-4: the proof is required, and it must be a document that has been CHECKED, of a kind that can prove this credential
  if p_document is null then
    raise exception 'credential_needs_document: choose the verified document that proves this credential';
  end if;
  select tutor_id, document_type::text as dtype, status::text as dstatus into d from public.tutor_verification_documents where id = p_document;
  if not found or d.tutor_id is distinct from p_tutor then
    raise exception 'That document does not belong to this tutor';
  end if;
  if d.dstatus <> 'verified' then
    raise exception 'credential_document_not_verified: verify the document first, then record the credential';
  end if;
  if v_accepted is not null then
    if not (d.dtype = any (v_accepted)) then
      raise exception 'credential_wrong_document: this kind of document does not prove this credential';
    end if;
  elsif d.dtype in ('identity_doc', 'police_clearance', 'subject_results') then
    raise exception 'credential_wrong_document: this kind of document does not prove a credential';
  end if;
  if v_recency is not null and p_obtained_on is null then
    raise exception 'credential_needs_date: enter the date this was obtained (it counts for % years)', v_recency;
  end if;
  if p_obtained_on is not null and p_obtained_on > (now() at time zone 'Africa/Johannesburg')::date then
    raise exception 'The date obtained cannot be in the future';
  end if;
  insert into public.tutor_credentials
    (tutor_id, credential_code, document_id, status, obtained_on, note, verified_by, verified_at)
  values (p_tutor, p_code, p_document, 'verified', p_obtained_on, nullif(trim(p_note), ''), auth.uid(), now())
  returning id into v_id;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'record_credential', 'credential', p_code, 'level', v_entry, 'obtained_on', p_obtained_on, 'document', p_document));
  return v_id;
end;
$function$;

create or replace function public.admin_credential_suggestions(p_document uuid)
returns table (code text, label text, entry_sub_tier_id text, needs_date boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_type text; v_status text;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can see this' using errcode = '42501'; end if;
  select document_type::text, status::text into v_type, v_status from public.tutor_verification_documents where id = p_document;
  if v_type is null or v_status <> 'verified' then return; end if;
  return query
    select d.code::text, d.label::text, d.entry_sub_tier_id::text, d.recency_years is not null
      from public.credential_definitions d
     where d.code <> 'admin_assigned' and d.entry_sub_tier_id is not null
       and (v_type = any (d.accepted_document_types) or (d.accepted_document_types is null and v_type not in ('identity_doc', 'police_clearance', 'subject_results')))
     order by d.entry_sub_tier_id, d.code;
end;
$$;

revoke all on function public.admin_credential_suggestions(uuid) from public, anon, service_role;
grant execute on function public.admin_credential_suggestions(uuid) to authenticated;
