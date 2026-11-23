-- 2026-11-23, P4 slice A (tutor verification: one place decides "ready", one transaction does the approving). PM build line 39 (23 Nov 2026).
-- Why: approving a tutor and reviewing a document were plain table updates from the browser followed by a SEPARATE audit insert, and the only check at the
-- database was "an ID and a police certificate that are not rejected" (a pending one passed). Three of the five verified tutors on production fail a "ready" test
-- written from the rules (a police certificate that aged after approval, documents never reviewed, documents rejected after approval).
-- What this migration does (ADDITIVE: no existing trigger, policy or table is changed or dropped; the two old triggers on is_verified stay as a second lock):
--   1. NEW public.tutor_readiness(tutor) -> jsonb { ready, reasons[], track, grandfathered, checked_at }. Read-only. The ONE statement of "ready":
--        a chosen track and the documents consent; an identity document with status verified; a police clearance with status verified and issued in the last
--        6 months up to today (SAST); 18 or older (a recorded date of birth); the third document for the track (beginner: subject_results, experienced:
--        proof_of_experience) verified; and NO document of any kind still pending or under review (a pending OPTIONAL document blocks; a rejected optional one
--        does not). A grandfathered tutor (0 today) is held to the age rule only, as the old trigger holds them.
--      Reason codes: no_track, no_consent, identity_missing, identity_not_verified, police_missing, police_not_verified, police_expired, dob_missing, under_18,
--      third_doc_missing, third_doc_not_verified, document_pending:<type>.
--   2. NEW public.admin_approve_tutor(tutor): verification officer or super admin; refuses unless tutor_readiness says ready (error text
--      'approval_not_ready:code,code'); sets onboarding_status and is_verified; writes the 'tutor_approved' audit line IN THE SAME TRANSACTION.
--   3. NEW public.admin_reject_tutor(tutor, reason): reason of at least 10 characters; sets rejected and is_verified false (this also takes a verified tutor back);
--      writes the 'tutor_rejected' audit line in the same transaction.
--   4. NEW public.admin_review_document(document, decision, reason, issued_on): verified / rejected / under_review; a rejection needs a reason (3 characters at
--      least; the screen builds it from a list later); verifying a police clearance needs an issue date inside the 6-month window (the date can be corrected in
--      the same call); updates the document and inserts the tutor_verification_audits line in one transaction. If the tutor is ALREADY verified and the review
--      leaves them not ready, nothing is suspended (PM decision 2: alert only): the result says tutor_still_ready:false and lists the reasons, for the screen.
--   5. REPLACES three existing functions, each with the SAME text plus one change (the old texts are in Drake/programmer/backups/2026-11-23-p4-slice-a/old-texts.sql):
--        admin_set_date_of_birth: now verification officer or super admin only (was: any active admin) (PM decision 4);
--        admin_assign_tier and admin_remove_credential: the reason must be at least 10 characters (was 3) (PM decision 5).
-- What it does NOT do (migration B, waits for a PM line): stop the browser's direct table updates of is_verified / onboarding_status / document status.
-- Execute rights: the four new functions are for signed-in callers only (the role check is inside); tutor_readiness is also for the server key; nobody anonymous.
-- No tutor's status changes when this is applied. Test: supabase/tests/p4_verification_functions.sql.

-- ---- 1. tutor_readiness -------------------------------------------------------------------------------------------------------------
create or replace function public.tutor_readiness(p_tutor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_oldest date := ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date;
  v_role text := coalesce(current_setting('role', true), 'none');
  v_dob date;
  v_track text;
  v_consented timestamptz;
  v_grand boolean := false;
  v_reasons text[] := '{}';
  v_slots text[] := '{}';
  v_third text;
  d record;
begin
  -- Who may ask: a verification officer or super admin (anyone), the tutor about themself, the server key, and the database's own functions.
  if v_role in ('authenticated', 'anon') then
    if not (public.admin_role_in(array['verification_officer', 'super_admin']) or auth.uid() = p_tutor) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;

  select o.track, o.consented_at, coalesce(o.grandfathered, false) into v_track, v_consented, v_grand
  from public.tutor_onboarding o where o.tutor_id = p_tutor;
  if not found then v_grand := false; end if;
  select p.date_of_birth into v_dob from public.profiles p where p.id = p_tutor;

  -- Age: always, grandfathered or not (the old trigger holds everyone to it).
  if v_dob is null then
    v_reasons := array_append(v_reasons, 'dob_missing');
  elsif v_dob > (v_today - interval '18 years')::date then
    v_reasons := array_append(v_reasons, 'under_18');
  end if;

  if not v_grand then
    if v_track is null then
      v_reasons := array_append(v_reasons, 'no_track');
    elsif v_consented is null then
      v_reasons := array_append(v_reasons, 'no_consent');
    end if;

    -- Identity document
    v_slots := array_append(v_slots, 'identity_doc');
    if not exists (select 1 from public.tutor_verification_documents x where x.tutor_id = p_tutor and x.document_type::text = 'identity_doc' and x.status::text = 'verified') then
      v_reasons := array_append(v_reasons,
        case when exists (select 1 from public.tutor_verification_documents x where x.tutor_id = p_tutor and x.document_type::text = 'identity_doc' and x.status::text <> 'rejected')
             then 'identity_not_verified' else 'identity_missing' end);
    end if;

    -- Police clearance: verified AND issued in the window
    v_slots := array_append(v_slots, 'police_clearance');
    if not exists (select 1 from public.tutor_verification_documents x
                   where x.tutor_id = p_tutor and x.document_type::text = 'police_clearance' and x.status::text = 'verified'
                     and x.issued_on is not null and x.issued_on <= v_today and x.issued_on >= v_oldest) then
      if exists (select 1 from public.tutor_verification_documents x
                 where x.tutor_id = p_tutor and x.document_type::text = 'police_clearance' and x.status::text <> 'rejected'
                   and x.issued_on is not null and x.issued_on <= v_today and x.issued_on >= v_oldest) then
        v_reasons := array_append(v_reasons, 'police_not_verified');
      elsif exists (select 1 from public.tutor_verification_documents x where x.tutor_id = p_tutor and x.document_type::text = 'police_clearance' and x.status::text <> 'rejected') then
        v_reasons := array_append(v_reasons, 'police_expired');
      else
        v_reasons := array_append(v_reasons, 'police_missing');
      end if;
    end if;

    -- The third document, by track
    if v_track in ('beginner', 'experienced') then
      v_third := case v_track when 'beginner' then 'subject_results' else 'proof_of_experience' end;
      v_slots := array_append(v_slots, v_third);
      if not exists (select 1 from public.tutor_verification_documents x where x.tutor_id = p_tutor and x.document_type::text = v_third and x.status::text = 'verified') then
        v_reasons := array_append(v_reasons,
          case when exists (select 1 from public.tutor_verification_documents x where x.tutor_id = p_tutor and x.document_type::text = v_third and x.status::text <> 'rejected')
               then 'third_doc_not_verified' else 'third_doc_missing' end);
      end if;
    end if;

    -- Every other file still waiting for a decision (an optional document too); a type already reported above is not repeated.
    for d in
      select distinct x.document_type::text as t from public.tutor_verification_documents x
      where x.tutor_id = p_tutor and x.status::text in ('pending', 'under_review') and not (x.document_type::text = any (v_slots))
      order by 1
    loop
      v_reasons := array_append(v_reasons, 'document_pending:' || d.t);
    end loop;
  end if;

  return jsonb_build_object('ready', coalesce(array_length(v_reasons, 1), 0) = 0, 'reasons', to_jsonb(v_reasons),
                            'track', v_track, 'grandfathered', v_grand, 'checked_at', now());
end;
$$;

-- ---- 2. admin_approve_tutor ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_approve_tutor(p_tutor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready jsonb;
  v_was boolean;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can approve a tutor' using errcode = '42501';
  end if;
  select is_verified into v_was from public.tutor_profiles where id = p_tutor for update;
  if not found then
    raise exception 'No such tutor';
  end if;
  if coalesce(v_was, false) then
    raise exception 'This tutor is already approved';
  end if;
  v_ready := public.tutor_readiness(p_tutor);
  if not (v_ready ->> 'ready')::boolean then
    raise exception 'approval_not_ready:%', (select string_agg(x, ',') from jsonb_array_elements_text(v_ready -> 'reasons') x);
  end if;
  update public.tutor_profiles set onboarding_status = 'verified', is_verified = true where id = p_tutor;
  perform public.log_admin_event('tutor_approved', 'tutor_profiles', p_tutor,
    jsonb_build_object('via', 'admin_approve_tutor', 'track', v_ready ->> 'track', 'grandfathered', (v_ready ->> 'grandfathered')::boolean, 'readiness_checked_at', v_ready ->> 'checked_at'));
  return v_ready;
end;
$$;

-- ---- 3. admin_reject_tutor ----------------------------------------------------------------------------------------------------------
create or replace function public.admin_reject_tutor(p_tutor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was boolean;
  v_status text;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can reject a tutor' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the reason (at least 10 characters)';
  end if;
  select is_verified, onboarding_status::text into v_was, v_status from public.tutor_profiles where id = p_tutor for update;
  if not found then
    raise exception 'No such tutor';
  end if;
  if not coalesce(v_was, false) and v_status = 'rejected' then
    raise exception 'This tutor was already not approved';
  end if;
  update public.tutor_profiles set onboarding_status = 'rejected', is_verified = false where id = p_tutor;
  perform public.log_admin_event('tutor_rejected', 'tutor_profiles', p_tutor,
    jsonb_build_object('via', 'admin_reject_tutor', 'reason', btrim(p_reason), 'was_verified', coalesce(v_was, false)));
end;
$$;

-- ---- 4. admin_review_document -------------------------------------------------------------------------------------------------------
create or replace function public.admin_review_document(p_document uuid, p_decision text, p_reason text default null, p_issued_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_oldest date := ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date;
  v_tutor uuid;
  v_type text;
  v_issued date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_tutor_verified boolean;
  v_ready jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can review documents' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('verified', 'rejected', 'under_review') then
    raise exception 'The decision must be verified, rejected or under_review';
  end if;
  select d.tutor_id, d.document_type::text, d.issued_on into v_tutor, v_type, v_issued
  from public.tutor_verification_documents d where d.id = p_document for update;
  if not found then
    raise exception 'No such document';
  end if;
  if p_decision = 'rejected' and char_length(coalesce(v_reason, '')) < 3 then
    raise exception 'Give the reason this document is not accepted';
  end if;
  if p_issued_on is not null then
    if p_issued_on > v_today then
      raise exception 'The issue date cannot be in the future';
    end if;
    v_issued := p_issued_on;
  end if;
  if p_decision = 'verified' and v_type = 'police_clearance' then
    if v_issued is null then
      raise exception 'police_clearance_date_missing: enter the date the certificate was issued before verifying it';
    end if;
    if v_issued < v_oldest then
      raise exception 'police_clearance_expired: the certificate was issued more than 6 months ago';
    end if;
  end if;

  update public.tutor_verification_documents
     set status = p_decision::public.verification_status, admin_notes = v_reason, reviewed_at = now(), issued_on = v_issued
   where id = p_document;
  insert into public.tutor_verification_audits (tutor_id, document_id, reviewer_id, decision, rejection_reason, reviewed_at)
  values (v_tutor, p_document, auth.uid(), p_decision::public.verification_status, v_reason, now());

  select coalesce(is_verified, false) into v_tutor_verified from public.tutor_profiles where id = v_tutor;
  v_ready := public.tutor_readiness(v_tutor);
  return jsonb_build_object('document', p_document, 'decision', p_decision, 'tutor_verified', coalesce(v_tutor_verified, false),
                            'tutor_still_ready', (v_ready ->> 'ready')::boolean, 'reasons', v_ready -> 'reasons');
end;
$$;

-- ---- 5. three existing functions, same text plus one change each ---------------------------------------------------------------------
create or replace function public.admin_set_date_of_birth(p_profile uuid, p_dob date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_previous date;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  -- P4 slice A (PM decision 4): the verification roles only.
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can record a date of birth' using errcode = '42501';
  end if;
  if not public.is_plausible_date_of_birth(p_dob) then
    raise exception 'Enter a real date of birth';
  end if;
  select date_of_birth into v_previous from public.profiles where id = p_profile;
  if not found then
    raise exception 'No such profile';
  end if;
  update public.profiles set date_of_birth = p_dob where id = p_profile;
  insert into public.admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, metadata)
  values (auth.uid(), 'date_of_birth_recorded', 'profiles', p_profile,
          jsonb_build_object('was_already_recorded', v_previous is not null));
end;
$function$;

create or replace function public.admin_assign_tier(p_tutor uuid, p_sub_tier text, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if not exists (select 1 from public.sub_tier_definitions where id = p_sub_tier) then
    raise exception 'No such level';
  end if;
  -- P4 slice A (PM decision 5): at least 10 characters (was 3).
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'Give the reason for this level (at least 10 characters)';
  end if;
  delete from public.tutor_credentials where tutor_id = p_tutor and credential_code = 'admin_assigned';
  insert into public.tutor_credentials
    (tutor_id, credential_code, status, assigned_sub_tier_id, note, obtained_on, verified_by, verified_at)
  values (p_tutor, 'admin_assigned', 'verified', p_sub_tier, trim(p_reason), current_date, auth.uid(), now());
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'assign_level', 'sub_tier', p_sub_tier, 'reason', trim(p_reason)));
end;
$function$;

create or replace function public.admin_remove_credential(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tutor uuid;
  v_code text;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
  end if;
  -- P4 slice A (PM decision 5): at least 10 characters (was 3).
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'Give the reason (at least 10 characters)';
  end if;
  delete from public.tutor_credentials where id = p_id returning tutor_id, credential_code into v_tutor, v_code;
  if not found then
    raise exception 'No such credential';
  end if;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', v_tutor,
    jsonb_build_object('action', 'remove_credential', 'credential', v_code, 'reason', trim(p_reason)));
end;
$function$;

-- ---- 6. who may call them -----------------------------------------------------------------------------------------------------------
revoke all on function public.tutor_readiness(uuid) from public, anon;
revoke all on function public.admin_approve_tutor(uuid) from public, anon, service_role;
revoke all on function public.admin_reject_tutor(uuid, text) from public, anon, service_role;
revoke all on function public.admin_review_document(uuid, text, text, date) from public, anon, service_role;
grant execute on function public.tutor_readiness(uuid) to authenticated, service_role;
grant execute on function public.admin_approve_tutor(uuid) to authenticated;
grant execute on function public.admin_reject_tutor(uuid, text) to authenticated;
grant execute on function public.admin_review_document(uuid, text, text, date) to authenticated;
-- The three replaced functions keep the rights they have (create or replace keeps them); stated here so a reader sees it:
--   admin_set_date_of_birth, admin_assign_tier, admin_remove_credential: authenticated (and service_role, which the role check inside refuses).
