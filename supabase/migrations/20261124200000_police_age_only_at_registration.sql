-- 2026-11-24, JOB POL (PM line 60, CEO): THE POLICE CERTIFICATE'S AGE MATTERS ONLY AT REGISTRATION. A tutor who is already VERIFIED is never "not ready", never refused a request, never
-- flagged by the nightly drift check or the admin watcher, never withheld from her public page, and never asked for a new certificate because her certificate is more than 6 months old.
-- Why: tutor_readiness() (P4) and police_clearance_problem() (20 Oct) both applied the 6-month window to everyone, forever, so a verified tutor (Odi) read "police_expired" and was a drift finding.
-- What this changes (create or replace; same names, same grants; nothing else):
--   1. tutor_readiness(tutor): for a tutor whose is_verified is true, the police clearance only has to be VERIFIED (any issue date); the window test stays for everyone who is not yet verified,
--      so a NEW applicant, or a tutor taken back by admin_reject_tutor, still needs a fresh certificate (admin_approve_tutor calls this function before approving). 'police_expired' can no
--      longer be raised for a verified tutor. The nightly drift scan and the admin watcher read this function, so they stop raising it; the next scan closes the finding already open.
--   2. police_clearance_problem(tutor): the check inside claim_session_request and accept_session_request: for a verified tutor an aged certificate is no problem (a missing or rejected one still is).
--   3. my_police_clearance_status(): for a verified tutor expires_on is null, so the Teach screen never says "add a new one before then".
--   4. tutor_checked_lines(tutor): "Police clearance checked, <Month Year>" now shows for the latest VERIFIED certificate whatever its age (Month Year = the month it was ISSUED, as of verification) and never disappears.
--      The words "vetted", "certified" and "background-checked" are still never produced.
-- NOT changed: admin_review_document (verifying a police certificate still needs an issue date in the last 6 months: that IS registration), enforce_tutor_documents_on_verify (approval needs a fresh one),
--   P4-3 and P4-4. Known and left: my_dashboard() (dashboard step 1, no screen built, feature off) still returns a 'counts_until' date for the police certificate.
-- Rollback: Drake/programmer/rollbacks/20261124200000_police_age_only_at_registration_ROLLBACK.sql (restores the four old texts). Test: supabase/tests/police_age_only_at_registration.sql.

-- ---- 1. tutor_readiness ------------------------------------------------------------------------------------------------------------------
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
  v_verified boolean := false;   -- 24 Nov 2026: a VERIFIED tutor is no longer held to the police certificate's age (only registration is)
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
  select coalesce(tp.is_verified, false) into v_verified from public.tutor_profiles tp where tp.id = p_tutor;

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
                     and (v_verified or (x.issued_on is not null and x.issued_on <= v_today and x.issued_on >= v_oldest))) then
      if exists (select 1 from public.tutor_verification_documents x
                 where x.tutor_id = p_tutor and x.document_type::text = 'police_clearance' and x.status::text <> 'rejected'
                   and (v_verified or (x.issued_on is not null and x.issued_on <= v_today and x.issued_on >= v_oldest))) then
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

-- ---- 2. police_clearance_problem ----------------------------------------------------------------------------------------------------------
create or replace function public.police_clearance_problem(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_any boolean;
  v_current boolean;
begin
  select count(*) > 0,
         coalesce(bool_or(d.issued_on is not null and d.issued_on <= v_today and d.issued_on >= (v_today - interval '6 months')::date), false)
    into v_any, v_current
  from public.tutor_verification_documents d
  where d.tutor_id = p_tutor and d.document_type = 'police_clearance' and d.status is distinct from 'rejected';
  if v_current then
    return null;
  end if;
  if v_any then
    -- 24 Nov 2026: the certificate's age matters only at registration. A verified tutor with a certificate on file (not rejected) has no problem, whatever its date.
    if exists (select 1 from public.tutor_profiles tp where tp.id = p_tutor and tp.is_verified) then
      return null;
    end if;
    return 'police_clearance_expired';
  end if;
  return 'police_clearance_missing';
end;
$$;

-- ---- 3. my_police_clearance_status --------------------------------------------------------------------------------------------------------
create or replace function public.my_police_clearance_status()
returns table (problem text, latest_issued_on date, expires_on date)
language sql
stable
security definer
set search_path = public
as $$
  select public.police_clearance_problem(t.id), l.issued_on,
         case when t.is_verified then null else (l.issued_on + interval '6 months')::date end
  from public.tutor_profiles t
  left join lateral (
    select max(d.issued_on) as issued_on
    from public.tutor_verification_documents d
    where d.tutor_id = t.id and d.document_type = 'police_clearance' and d.status is distinct from 'rejected'
  ) l on true
  where t.id = auth.uid();
$$;

-- ---- 4. tutor_checked_lines ---------------------------------------------------------------------------------------------------------------
create or replace function public.tutor_checked_lines(p_tutor uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out text[] := '{}';
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_police date;
begin
  if exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p_tutor and d.document_type::text = 'identity_doc' and d.status::text = 'verified') then
    v_out := array_append(v_out, 'ID checked');
  end if;
  if exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p_tutor and d.status::text = 'verified'
              and d.document_type::text in ('matric_certificate', 'university_transcript', 'teaching_qualification', 'subject_results')) then
    v_out := array_append(v_out, 'Results or qualification checked');
  end if;
  -- the latest VERIFIED certificate, whatever its age: the line is the month it was issued, as of verification, and never disappears
  select max(d.issued_on) into v_police from public.tutor_verification_documents d
   where d.tutor_id = p_tutor and d.document_type::text = 'police_clearance' and d.status::text = 'verified'
     and d.issued_on is not null and d.issued_on <= v_today;
  if v_police is not null then
    v_out := array_append(v_out, 'Police clearance checked, ' || to_char(v_police, 'FMMonth YYYY'));
  end if;
  return v_out;
end;
$$;
