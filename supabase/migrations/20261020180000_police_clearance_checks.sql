-- Police clearance and ID checks in the database (CEO, 21 Oct 2026: "ID and police certificate"; accepting = "issued within 6 months and not rejected").
-- NOT APPLIED anywhere. Tested rolled back on dev only (supabase/tests/police_clearance_checks.sql). To be applied to production at the move, on its own yes.
--
-- WHAT THIS DOES
--  1. Approval: setting tutor_profiles.is_verified from false to true is refused unless the tutor has (a) an identity document on file that is
--     not rejected and (b) a police clearance certificate on file that is not rejected and whose issue date is in the last 6 months.
--     Tutors marked grandfathered (the test-phase tutors, tutor_onboarding.grandfathered) are not held to this at approval; a tutor with NO
--     onboarding row is held to it. The refusal message is a token the admin app turns into a plain sentence:
--        approval_needs_documents:identity_missing,police_clearance_missing   (or police_clearance_expired)
--     Only requests that come through the API (the admin app, a signed-in user, the Worker's service key) are held to this. A session that
--     runs as the database owner with no API role (the SQL editor, a migration, the rolled-back test fixtures) is not.
--  2. Accepting: claim_session_request and accept_session_request refuse a tutor whose police clearance is missing, or has no non-rejected
--     certificate issued in the last 6 months. This applies to EVERY tutor, grandfathered or not. The refusal message is one of two tokens:
--        police_clearance_missing | police_clearance_expired
--     (the tutor's request list turns them into a plain sentence; the Worker passes the database's message through).
--  3. my_police_clearance_status(): what the tutor's own screen needs to say "upload a current certificate"; the app calls it and shows nothing
--     if it is missing, so the app can be published before this is applied.
--
-- WHAT THIS REPLACES (plain words)
--  - claim_session_request(uuid, uuid): the version from 20261019120000_best_fit_first_matching.sql, same logic, plus one check straight after
--    "is the tutor approved?". (This is the version that is live on dev and production; the stored text matched the file on dev on 21 Oct.)
--  - accept_session_request(uuid): the same, plus the same check.
--  No other function and no existing trigger is replaced. New: police_clearance_problem(uuid), enforce_tutor_documents_on_verify() with its
--  trigger on tutor_profiles, my_police_clearance_status().
-- Execute rights: create or replace keeps the existing grants of the two replaced functions (claim: the Worker's service role only; accept: nobody
-- but the owner). The new helper and trigger function are closed to API roles; my_police_clearance_status() is for signed-in users.

-- 1. the shared rule: does this tutor have a current police clearance? ----------------------------------------------------------------
-- null = yes. 'police_clearance_missing' = no certificate on file that is not rejected. 'police_clearance_expired' = there is one, but none was
-- issued in the last 6 months (or the date is missing or in the future). The date is South African time, as in the app (policeCertificateProblem).
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
    return 'police_clearance_expired';
  end if;
  return 'police_clearance_missing';
end;
$$;
revoke all on function public.police_clearance_problem(uuid) from public, anon, authenticated;

-- 2. approval -----------------------------------------------------------------------------------------------------------------------
create or replace function public.enforce_tutor_documents_on_verify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_problems text[] := '{}';
  v_police text;
begin
  if new.is_verified and not coalesce(old.is_verified, false) then
    -- Not held to this: a session with no API role (the owner typing SQL, a migration) and a grandfathered tutor.
    if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon', 'service_role') then
      return new;
    end if;
    if exists (select 1 from public.tutor_onboarding o where o.tutor_id = new.id and o.grandfathered) then
      return new;
    end if;
    if not exists (
      select 1 from public.tutor_verification_documents d
      where d.tutor_id = new.id and d.document_type = 'identity_doc' and d.status is distinct from 'rejected'
    ) then
      v_problems := array_append(v_problems, 'identity_missing');
    end if;
    v_police := public.police_clearance_problem(new.id);
    if v_police is not null then
      v_problems := array_append(v_problems, v_police);
    end if;
    if array_length(v_problems, 1) is not null then
      raise exception 'approval_needs_documents:%', array_to_string(v_problems, ',');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_tutor_documents_on_verify() from public, anon, authenticated;
drop trigger if exists enforce_tutor_documents_on_verify on public.tutor_profiles;
create trigger enforce_tutor_documents_on_verify
  before update of is_verified on public.tutor_profiles
  for each row execute function public.enforce_tutor_documents_on_verify();

-- 3. the tutor's own view -------------------------------------------------------------------------------------------------------------
create or replace function public.my_police_clearance_status()
returns table (problem text, latest_issued_on date, expires_on date)
language sql
stable
security definer
set search_path = public
as $$
  select public.police_clearance_problem(t.id), l.issued_on, (l.issued_on + interval '6 months')::date
  from public.tutor_profiles t
  left join lateral (
    select max(d.issued_on) as issued_on
    from public.tutor_verification_documents d
    where d.tutor_id = t.id and d.document_type = 'police_clearance' and d.status is distinct from 'rejected'
  ) l on true
  where t.id = auth.uid();
$$;
revoke all on function public.my_police_clearance_status() from public, anon, authenticated;
grant execute on function public.my_police_clearance_status() to authenticated;

-- 4. accepting: exactly the best-fit versions, plus the check ------------------------------------------------------------------------
create or replace function public.claim_session_request(p_request_id uuid, p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tutor record;
  v_req record;
  v_fit text;
  v_level_rate numeric;
  v_commission numeric;
  v_commission_amount numeric;
  v_card record;
  v_subaccount text;
  v_bearer text;
  v_reference text;
  v_session uuid;
  v_problem text;
begin
  if p_tutor_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = p_tutor_id
  for update of tp;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests' using errcode = '42501';
  end if;

  -- A current police clearance certificate (issued in the last 6 months, not rejected) is needed to accept. A grandfathered flag does not excuse it.
  -- The message is a token (police_clearance_missing or police_clearance_expired) that the app turns into a plain sentence.
  v_problem := public.police_clearance_problem(p_tutor_id);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '42501';
  end if;

  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.tutor_id is not null or v_req.status <> 'pending'
     or v_req.payment_status not in ('paid', 'card_verified') then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  -- No self-matching (found 2026-10-05): a tutor account is an adult, so it can book for itself,
  -- and nothing stopped it accepting that same request. That would let a tutor buy hours and
  -- ratings towards a higher level. The tutor can never be the learner or the person who booked.
  if p_tutor_id = v_req.student_id or p_tutor_id = v_req.requested_by_profile_id then
    raise exception 'You can''t accept your own request.' using errcode = '42501';
  end if;

  -- Keep or swap: a request addressed to someone else, one past its end, and one between a learner and a tutor
  -- who are parted (the learner chose "try someone else", or the tutor ended the pairing) cannot be accepted.
  -- The words are the same for all three, so nobody learns why.
  if v_req.requested_tutor_id is not null and v_req.requested_tutor_id <> p_tutor_id then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;
  if v_req.expires_at is not null and v_req.expires_at <= now() then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;
  if public.pairing_blocked(v_req.student_id, p_tutor_id) then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate into v_level_rate from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  elsif v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
    raise exception 'This request is for a different pricing level.';
  end if;
  -- Checked again here, not only when the request was shown: the school, an approved subject, grade and curriculum, and free at that time
  -- for the first 5 minutes; then (request_is_widened) only an approved subject and grade, and free at that time.
  v_fit := public.request_fit_code(p_tutor_id, p_request_id);
  if v_fit is not null then
    raise exception '%', public.tutor_fit_sentence(v_fit);
  end if;

  v_commission := public.request_commission_pct(p_request_id, v_tutor.current_tier_id);
  if v_commission is null then
    raise exception 'No commission rate is set for this level — contact support';
  end if;
  v_commission_amount := round(v_req.charged_amount * v_commission / 100, 2);

  -- Paid up front under the old flow: book it without charging again.
  if v_req.payment_status = 'paid' then
    v_session := public.create_session_from_request(p_request_id, p_tutor_id, v_commission,
                                                    v_req.charged_amount - v_commission_amount);
    update public.session_requests set commission_amount = v_commission_amount where id = p_request_id;
    return jsonb_build_object('mode', 'already_paid', 'session_id', v_session);
  end if;

  select paystack_subaccount_code into v_subaccount
  from public.tutor_payout_accounts where tutor_id = p_tutor_id;
  if v_subaccount is null then
    raise exception 'Add your bank details in your tutor account before accepting paid requests — that''s where your share is paid.';
  end if;

  select * into v_card from public.payment_cards where id = v_req.payment_card_id;
  if v_card.id is null or v_card.revoked_at is not null or not v_card.reusable then
    raise exception 'This request''s card can''t be charged any more — it has been withdrawn.';
  end if;

  select setting_value #>> '{}' into v_bearer from public.system_settings where setting_key = 'paystack_fee_bearer';
  if v_bearer is null or v_bearer not in ('account', 'subaccount') then
    raise exception 'Payments aren''t configured yet (paystack_fee_bearer) — contact support';
  end if;

  v_reference := 'chg_' || replace(gen_random_uuid()::text, '-', '');
  update public.session_requests
  set tutor_id = p_tutor_id, payment_status = 'charging', claimed_at = now(), charge_reference = v_reference,
      commission_amount = v_commission_amount, fee_bearer = v_bearer, charge_failure_reason = null,
      charge_check_request_id = null
  where id = p_request_id;

  return jsonb_build_object(
    'mode', 'charge',
    'charge_reference', v_reference,
    'authorization_code', v_card.authorization_code,
    'email', v_card.paystack_email,
    'amount_cents', round(v_req.charged_amount * 100)::bigint,
    'commission_cents', round(v_commission_amount * 100)::bigint,
    'currency', trim(v_req.currency_code),
    'subaccount', v_subaccount,
    'bearer', v_bearer
  );
end;
$function$;

create or replace function public.accept_session_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tutor record;
  v_req record;
  v_fit text;
  v_commission numeric;
  v_level_rate numeric;
  v_session_id uuid;
  v_problem text;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = v_uid
  for update of tp;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests'
      using errcode = '42501';
  end if;

  -- A current police clearance certificate (issued in the last 6 months, not rejected) is needed to accept. A grandfathered flag does not excuse it.
  -- The message is a token (police_clearance_missing or police_clearance_expired) that the app turns into a plain sentence.
  v_problem := public.police_clearance_problem(v_uid);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '42501';
  end if;

  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.tutor_id is not null or v_req.status <> 'pending' or v_req.payment_status <> 'paid' then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate, commission_rate_pct into v_level_rate, v_commission
    from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  else
    if v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
      raise exception 'This request is for a different pricing level.';
    end if;
  end if;
  if v_commission is null then
    select commission_rate_pct into v_commission from public.tier_definitions where id = coalesce(v_req.tier_id, v_tutor.current_tier_id);
  end if;

  -- The school, subject, grade, curriculum and time rules, best fit for the first 5 minutes and wider after (request_fit_code).
  v_fit := public.request_fit_code(v_uid, p_request_id);
  if v_fit is not null then
    raise exception '%', public.tutor_fit_sentence(v_fit);
  end if;

  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status
  ) values (
    v_req.student_id, v_uid, v_req.duration_hours, round(v_req.charged_amount / v_req.duration_hours, 2),
    v_commission, v_req.charged_amount, round(v_req.charged_amount * (1 - v_commission / 100), 2),
    v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.currency_code,
    'scheduled'
  ) returning id into v_session_id;

  update public.session_requests
  set tutor_id = v_uid, status = 'accepted', responded_at = now(), resulting_session_id = v_session_id
  where id = p_request_id;

  return v_session_id;
end;
$function$;
