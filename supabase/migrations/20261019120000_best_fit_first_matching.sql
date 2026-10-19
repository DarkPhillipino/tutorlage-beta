-- Best fit first, then wider after 5 minutes (CEO, 19 Oct 2026, word for word: "use the constraints that best fit the user to the T and
-- prioritise tutors that meet those constraints, once a tutor doesn't accept a request within 5 minutes widen the search to whomever is
-- available at the requested time for the requested grade for the requested subject").
--
-- Applies to a request nobody in particular was asked to take (requested_tutor_id is null). A "book again" request, sent to one tutor, is
-- exactly as before.
--   * For the first 5 minutes after the request was made (session_requests.created_at) only a tutor who fits ALL of it sees it and can
--     accept it: the level, the school, an approved subject, the grade, the curriculum, and free at the requested time and length.
--   * From 5 minutes on, any tutor sees it and can accept it who is of the right LEVEL (nobody accepts below the price paid), approved for
--     the subject and the grade, and free at that time. The school and the curriculum are no longer asked.
--   * A request that is the resend of an earlier one ("try someone else" on a book-again request, resent_from is set) has already waited,
--     so it is open from the start. (Choice of mine: the CEO's words do not cover it.)
--   * Unchanged: not your own request, a parted pairing, an expired request, the card and the payment steps.
-- The 5 is one number: the setting request_widen_after_minutes (system_settings, edited in the admin app's settings page).
-- The rules are kept in one place each: request_is_widened (is it open to everyone yet), request_fit_code (does this tutor fit this
-- request now; it now also holds the school rule), and the existing tutor_qualify_problem / tutor_free_problem.
--
-- Replaced (same signature and permissions): request_fit_code, tutor_fit_sentence, available_price_levels, available_requests_for_tutor,
-- claim_session_request, accept_session_request. New: request_widen_interval, request_is_widened, the setting row.
-- No table or column changes.

insert into public.system_settings (setting_key, setting_value, description) values
  ('request_widen_after_minutes', '5'::jsonb,
   'Minutes a new request is shown only to the tutors who fit it exactly (level, school, approved subject, grade, curriculum, free at that time). After that it is shown to any tutor of the right level who is approved for the subject and grade and free at that time. A "book again" request is not affected.')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- The one number, and the one question "is this request open to everyone yet?"
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.request_widen_interval()
returns interval
language sql
stable
security definer
set search_path = public
as $$
  -- A setting that is not a number, or is negative, is ignored (the nested CASE keeps the cast from running on a word).
  select (coalesce(
    (select case when jsonb_typeof(s.setting_value) = 'number'
                 then case when (s.setting_value #>> '{}')::numeric >= 0 then (s.setting_value #>> '{}')::numeric end
            end
       from public.system_settings s
      where s.setting_key = 'request_widen_after_minutes'),
    5)::float8) * interval '1 minute';
$$;
revoke all on function public.request_widen_interval() from public, anon, authenticated;

-- True for a request nobody in particular was asked to take, once it is old enough, or when it is the resend of an earlier one.
create or replace function public.request_is_widened(p_requested_tutor uuid, p_created_at timestamptz, p_resent_from uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_requested_tutor is null
     and (p_resent_from is not null or now() >= coalesce(p_created_at, now()) + public.request_widen_interval());
$$;
revoke all on function public.request_is_widened(uuid, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Does this tutor fit this request right now? null = yes, else a code (see tutor_fit_sentence).
-- Best fit: the school, then an approved subject, grade and curriculum, then free. Widened: no school and no curriculum.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.request_fit_code(p_tutor uuid, p_request uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
  v_code text;
  v_school uuid;
begin
  select r.institution_id, r.curriculum_id, r.requested_start, r.duration_hours, r.requested_tutor_id, r.created_at, r.resent_from,
         e.subject_name, e.grade_level
    into v
    from public.session_requests r
    left join public.student_subject_enrollments e on e.id = r.enrollment_id
   where r.id = p_request;
  if not found then
    return 'no_request';
  end if;

  if public.request_is_widened(v.requested_tutor_id, v.created_at, v.resent_from) then
    v_code := public.tutor_qualify_problem(p_tutor, v.subject_name, v.grade_level, null, null);
  else
    select tp.institution_id into v_school from public.tutor_profiles tp where tp.id = p_tutor;
    if v.institution_id is not null and v_school is not null and v.institution_id <> v_school then
      return 'wrong_school';
    end if;
    v_code := public.tutor_qualify_problem(p_tutor, v.subject_name, v.grade_level, v.institution_id, v.curriculum_id);
  end if;
  if v_code is not null then
    return v_code;
  end if;
  return public.tutor_free_problem(p_tutor, greatest(v.requested_start, now()), v.duration_hours, p_request);
end;
$$;

-- What a tutor is told when they cannot take a request.
create or replace function public.tutor_fit_sentence(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_code
    when 'wrong_school' then 'This request is for a different institution.'
    when 'no_subject' then 'You don''t teach this subject yet.'
    when 'not_approved' then 'Tutorlage hasn''t approved this subject for you yet.'
    when 'wrong_grade' then 'This request is for a grade outside the range you teach.'
    when 'wrong_curriculum' then 'This request is for a curriculum you aren''t approved for.'
    when 'no_hours' then 'Set your weekly working hours before you accept requests.'
    when 'outside_hours' then 'This session is outside your weekly working hours.'
    when 'busy' then 'You already have a session at that time.'
    else 'Another tutor already accepted this request, or it is no longer available.'
  end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- The price counts: how many tutors could take a request at each level once it has widened (the learner sees one number; the
-- request reaches the best-fit tutors first and anyone of the right level who is approved and free after 5 minutes). So the school
-- and the curriculum no longer narrow it (p_institution and p_curriculum are still accepted, so the calls do not change); the subject,
-- the grade and, when a start and length are sent, the free time still do.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.available_price_levels(
  p_subject text, p_grade text, p_institution uuid,
  p_start timestamptz default null, p_hours numeric default null, p_curriculum uuid default null
)
returns table(level_id character varying, tier_id integer, tier_name text, price numeric, currency_code text, tutors integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with eligible_tutors as (
    select tp.id, st.max_allowed_rate as tutor_rate
    from public.tutor_profiles tp
    join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
    where tp.is_verified
      and not (coalesce(tp.tier_frozen, false) and tp.freeze_reason is distinct from 'Average rating dropped below 4.70 threshold.')
      and public.tutor_qualifies(tp.id, p_subject, p_grade, null, null)
      and (p_start is null or p_hours is null or public.tutor_free_for(tp.id, p_start, p_hours))
  )
  select s.id, s.tier_id, t.public_name, s.max_allowed_rate, trim(t.currency_code),
         (select count(*)::integer from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  from public.sub_tier_definitions s
  join public.tier_definitions t on t.id = s.tier_id
  where s.id not in ('4C', '4D')
    and exists (select 1 from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  order by s.max_allowed_rate;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- The tutor's inbox: what this tutor could accept right now (the same rules the accept applies)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.available_requests_for_tutor()
returns table(id uuid, requested_start timestamptz, duration_hours numeric, enrollment_id uuid, charged_amount numeric,
              currency_code text, institution_id uuid, subject_name text, grade_level text, tier_id integer, tier_name text,
              level_id text, level_commission_pct numeric, sent_to_you boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return query
  select r.id,
         r.requested_start,
         r.duration_hours,
         r.enrollment_id,
         r.charged_amount,
         trim(r.currency_code)::text,
         r.institution_id,
         e.subject_name::text,
         e.grade_level::text,
         r.tier_id,
         t.public_name::text,
         r.min_sub_tier_id::text,
         s.commission_rate_pct,
         (r.requested_tutor_id is not null),
         r.expires_at
    from public.session_requests r
    join public.tutor_profiles tp on tp.id = auth.uid() and tp.is_verified
    join public.sub_tier_definitions ts on ts.id = tp.current_sub_tier_id
    left join public.student_subject_enrollments e on e.id = r.enrollment_id
    left join public.tier_definitions t on t.id = r.tier_id
    left join public.sub_tier_definitions s on s.id = r.min_sub_tier_id
   where r.tutor_id is null
     and r.status = 'pending'
     and r.payment_status in ('card_verified', 'paid')
     and (r.expires_at is null or r.expires_at > now())
     and (r.requested_tutor_id is null or r.requested_tutor_id = auth.uid())
     and r.student_id <> auth.uid()
     and r.requested_by_profile_id <> auth.uid()
     and not public.pairing_blocked(r.student_id, auth.uid())
     -- only what this tutor could actually accept (the same rules claim_session_request applies, so nobody is shown a request
     -- they would be refused): a level at or below theirs (older requests without a level: the same tier), and a request that
     -- fits them (request_fit_code: best fit for the first 5 minutes, then the widened rule; see the top of this file).
     and (case when r.min_sub_tier_id is not null then s.max_allowed_rate <= ts.max_allowed_rate
               else r.tier_id is null or r.tier_id = tp.current_tier_id end)
     and public.request_fit_code(tp.id, r.id) is null
   order by r.requested_start;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Accepting: as before (level, own request, addressed, expired, parted), but the school rule now lives in request_fit_code with the rest
-- of what widens after 5 minutes. The payment steps are exactly as they were.
-- ---------------------------------------------------------------------------------------------------------
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

