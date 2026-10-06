-- A tutor can no longer accept a request they made themselves (test phase 1 finding, 2026-10-05).
--
-- can_book_for() lets any adult account book for itself, and a tutor account is an adult, so a
-- tutor could send a request from the Learn tab, see it on their own GO screen and accept it.
-- claim_session_request() checked level, institution and subject, but never that the tutor and
-- the learner (or the guardian who booked) are different people. With real money that would let a
-- tutor pay the commission to buy completed hours and a 5-star rating towards a higher level.
--
-- The function below is 20260930239500's claim_session_request(), unchanged except for the new
-- check after the request is locked. The browser also hides a tutor's own requests
-- (fetchAvailableRequests), but this check is the one that matters.
--
-- Test: supabase/tests/7a_no_self_match.sql (rolled back).

create or replace function public.claim_session_request(p_request_id uuid, p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor record;
  v_req record;
  v_subject text;
  v_level_rate numeric;
  v_commission numeric;
  v_commission_amount numeric;
  v_card record;
  v_subaccount text;
  v_bearer text;
  v_reference text;
  v_session uuid;
begin
  if p_tutor_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = p_tutor_id;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests' using errcode = '42501';
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


  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate into v_level_rate from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  elsif v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
    raise exception 'This request is for a different pricing level.';
  end if;
  if v_req.institution_id is not null and v_tutor.institution_id is not null
     and v_req.institution_id <> v_tutor.institution_id then
    raise exception 'This request is for a different institution.';
  end if;
  if v_req.enrollment_id is not null then
    select subject_name into v_subject from public.student_subject_enrollments where id = v_req.enrollment_id;
    if v_subject is not null and not exists (
      select 1 from public.tutor_subject_competencies c
      where c.tutor_id = p_tutor_id and lower(c.subject_name) = lower(v_subject)
    ) then
      raise exception 'You don''t teach this subject yet.';
    end if;
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
$$;
revoke all on function public.claim_session_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_session_request(uuid, uuid) to service_role;
