-- 2026-09-30. Backlog 12b (per-level commission) and 12a (Model 3, "minimum level").
-- A student picks a price level (sub-tier) as a floor and pays that level's price; any verified tutor
-- at that level or above can accept. The platform's commission follows the level paid for, from the
-- schedule the CEO confirmed (game-plan.md: 2D = 25%, 3A = 23%, 4D = 13%), so rand commission rises
-- at every step.

-- 12b ---------------------------------------------------------------------------------------------
alter table public.sub_tier_definitions add column if not exists commission_rate_pct numeric(5, 2);
update public.sub_tier_definitions set commission_rate_pct = v.pct
from (values
  ('1A', 30.00), ('1B', 30.00), ('1C', 30.00), ('1D', 30.00),
  ('2A', 28.00), ('2B', 27.00), ('2C', 26.00), ('2D', 25.00),
  ('3A', 23.00), ('3B', 22.00), ('3C', 21.00), ('3D', 20.00),
  ('4A', 19.00), ('4B', 18.00), ('4C', 16.50), ('4D', 13.00)
) as v(id, pct)
where sub_tier_definitions.id = v.id;

-- 12a ---------------------------------------------------------------------------------------------
alter table public.session_requests
  add column if not exists min_sub_tier_id varchar references public.sub_tier_definitions(id);

-- Price comes from the chosen level; tier_id is derived from it. (Requests without a level fall back
-- to the tier floor, so nothing in flight breaks.)
create or replace function public.guard_session_request_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  v_price numeric;
  v_currency text;
  v_tier integer;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.tutor_id := null;
  new.status := 'pending';
  new.payment_status := 'initiated';
  new.resulting_session_id := null;
  new.refund_request_id := null;
  new.responded_at := null;

  if new.duration_hours is null or new.duration_hours <= 0 or new.duration_hours > 8 then
    raise exception 'A session has to be between a few minutes and 8 hours long';
  end if;
  if new.paystack_reference is null or new.paystack_reference !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception 'A valid payment reference is required';
  end if;

  if new.min_sub_tier_id is not null then
    select s.max_allowed_rate, s.tier_id, t.currency_code into v_price, v_tier, v_currency
    from public.sub_tier_definitions s join public.tier_definitions t on t.id = s.tier_id
    where s.id = new.min_sub_tier_id;
    if v_price is null then
      raise exception 'Unknown price level';
    end if;
    new.tier_id := v_tier;
  elsif new.tier_id is not null then
    select min_rate, currency_code into v_price, v_currency from public.tier_definitions where id = new.tier_id;
    if v_price is null then
      raise exception 'Unknown pricing level';
    end if;
  else
    raise exception 'Choose a price level before sending a request';
  end if;

  new.charged_amount := round(v_price * new.duration_hours, 2);
  new.currency_code := trim(v_currency);
  return new;
end;
$$;

-- Which levels can be booked right now for this search: a level is available when at least one
-- verified, non-suspended tutor who teaches the subject at that grade (and institution, if both set
-- one) sits at that level or above. 4C and 4D are held — priced above anything observed in the
-- market study — so they're never offered.
create or replace function public.available_price_levels(p_subject text, p_grade text, p_institution uuid)
returns table (level_id varchar, tier_id integer, tier_name text, price numeric, currency_code text, tutors integer)
language sql stable security definer set search_path = public as $$
  with target_grade as (
    select sort_order from public.grade_levels where lower(name) = lower(nullif(trim(p_grade), ''))
  ),
  eligible_tutors as (
    select tp.id, st.max_allowed_rate as tutor_rate
    from public.tutor_profiles tp
    join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
    where tp.is_verified
      and not (coalesce(tp.tier_frozen, false) and tp.freeze_reason is distinct from 'Average rating dropped below 4.70 threshold.')
      and (p_institution is null or tp.institution_id is null or tp.institution_id = p_institution)
      and (
        nullif(trim(p_subject), '') is null
        or exists (
          select 1 from public.tutor_subject_competencies c
          left join public.grade_levels gmin on lower(gmin.name) = lower(c.min_grade_level)
          left join public.grade_levels gmax on lower(gmax.name) = lower(c.max_grade_level)
          where c.tutor_id = tp.id
            and c.verification_status = 'verified'
            and c.subject_name ilike '%' || trim(p_subject) || '%'
            and (
              not exists (select 1 from target_grade)
              or (select sort_order from target_grade) between gmin.sort_order and gmax.sort_order
            )
        )
      )
  )
  select s.id, s.tier_id, t.public_name, s.max_allowed_rate, trim(t.currency_code),
         (select count(*)::integer from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  from public.sub_tier_definitions s
  join public.tier_definitions t on t.id = s.tier_id
  where s.id not in ('4C', '4D')
    and exists (select 1 from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  order by s.max_allowed_rate;
$$;
revoke all on function public.available_price_levels(text, text, uuid) from public;
grant execute on function public.available_price_levels(text, text, uuid) to anon, authenticated;

-- Accepting: a tutor may take a request at their level or below; commission follows the level paid.
create or replace function public.accept_session_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tutor record;
  v_req record;
  v_subject text;
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
  where tp.id = v_uid;
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

  if v_req.institution_id is not null and v_tutor.institution_id is not null
     and v_req.institution_id <> v_tutor.institution_id then
    raise exception 'This request is for a different institution.';
  end if;
  if v_req.enrollment_id is not null then
    select subject_name into v_subject from public.student_subject_enrollments where id = v_req.enrollment_id;
    if v_subject is not null and not exists (
      select 1 from public.tutor_subject_competencies c
      where c.tutor_id = v_uid and lower(c.subject_name) = lower(v_subject)
    ) then
      raise exception 'You don''t teach this subject yet.';
    end if;
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
$$;
revoke all on function public.accept_session_request(uuid) from public, anon;
grant execute on function public.accept_session_request(uuid) to authenticated;
