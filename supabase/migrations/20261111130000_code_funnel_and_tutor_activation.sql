-- THE CODES FUNNEL (R12) AND THE TUTOR ACTIVATION LIST (R13), 11 Nov 2026. Programmer B.
-- Two READ-ONLY functions for the admin app's Codes page. They change no row, no setting and no existing function; a re-run is harmless.
--   NEW function  public.admin_code_funnel(p_from date, p_to date)   per code, per day and in total, for the range (South African days):
--        link opens and unique visitors (from the page counter's 'code_open' event), sign-ups, wallet funded, the 1st / 2nd / 3rd booking with the code, the 4th booking,
--        the first lesson completed, lessons discounted, rand given away and rand booked (net of returns), tutor bonus accrued and held back, requests that expired
--        unserved; plus a baseline (sign-ups in the same days with and without a code) and the state of the opens counter.
--   NEW function  public.admin_tutor_activation(p_quiet_days integer)   per verified tutor: their personal code, family opens and sign-ups, and how far they have got
--        (subjects, hours, first request seen, first accepted, first completed); a "quiet" mark for a tutor approved N or more days ago (default 7) who has no saved hours
--        or has accepted nothing since approval.
-- FINANCE ADMINS ONLY (wallet_is_finance_admin(), the same door as the rest of the Codes page). Both return counts, codes, tutor names and dates: no email, phone number,
-- family name or any other personal detail of a family.
-- DEFINITIONS (each is one line below; the page prints the limits beside the numbers):
--   * a day is a South African day (Africa/Johannesburg), 00:00 to 23:59. Every number counts an event on the day it happened, so a family that signs up on day 1 and books on
--     day 9 appears in each step on its own day: these are daily events, not a cohort.
--   * sign-up = a profile whose promo_code_id is the code, on the day promo_attached_at was set (at sign-up, or later when an admin attached the code: counted separately too).
--   * wallet funded = the family's FIRST successful top-up, on the day it was decided.
--   * 1st / 2nd / 3rd booking = a promo_code_uses row with that lesson_number that was not returned, on the day it was made. A use that was returned (expired, declined,
--     cancelled) does not count; it shows once as "returned" on the day it was returned.
--   * 4th booking = the family's 4th session that was not cancelled, on the day it was booked (after the discount ends, while a code covers 3 lessons).
--   * first lesson completed = the family's first completed session, on the day it was completed.
--   * rand booked = amount_off of the uses not returned, by booking day; rand given = the same for lessons that were completed, by completion day. Both are net of returns.
--   * tutor bonus = paid minus reversed (tutor_bonuses), on the day it was paid; "held back" = wanted minus paid (the R15 floor).
--   * expired unserved = a request by a family of the code with status expired and no session, on the day it expired.
--   * unique visitor = a distinct visitor id whose FIRST code_open event carries the code (a visitor who opens code A then code B counts for A only).
--   * the baseline counts the parents and the learners who signed up themselves (not a learner a parent added) created in the range: with a code attached, and without
--     (a mistyped code counts as without).
--   * opens counter: 'live' once any code_open event exists; 'not_live' before that. The page says "opens not counted yet", never "nobody opened it", while it is not live.
-- tutor_activation tolerates a column that may not exist yet (tutor_profiles.verified_at and hours_saved_at from the founding waves work) by reading the row as JSON, so
-- it works the same before and after that migration.

-- 1. the codes funnel -------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_code_funnel(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'Africa/Johannesburg';
  v_to date;
  v_from date;
  v_live boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to then
    raise exception 'The start date is after the end date.' using errcode = '22023';
  end if;
  if v_to - v_from > 365 then
    raise exception 'Pick a range of one year or less.' using errcode = '22023';
  end if;
  v_live := exists (select 1 from public.founding_page_events e where e.event = 'code_open');

  with
  fam as (
    select p.id, p.promo_code_id as code_id, p.promo_attached_at, p.promo_attached_by
      from public.profiles p
     where p.promo_code_id is not null
  ),
  booked as (   -- every session that was not cancelled, numbered per booker in the order it was booked
    select s.booked_by_profile_id as booker, s.created_at,
           row_number() over (partition by s.booked_by_profile_id order by s.created_at, s.id) as rn
      from public.sessions s
     where s.booked_by_profile_id is not null and s.status not in ('cancelled_by_tutor', 'cancelled_by_student')
  ),
  ev_all(code_id, ts, kind, n) as (
    -- link opens, and the first-ever code_open of each visitor
    select c.id, e.created_at, 'open', 1::bigint
      from public.founding_page_events e join public.promo_codes c on lower(c.code) = e.src
     where e.event = 'code_open'
    union all
    select c.id, f.created_at, 'visitor', 1::bigint
      from (select distinct on (e.visitor_id) e.src, e.created_at
              from public.founding_page_events e where e.event = 'code_open' order by e.visitor_id, e.created_at, e.id) f
      join public.promo_codes c on lower(c.code) = f.src
    union all
    -- sign-ups (and the ones an admin attached)
    select fam.code_id, fam.promo_attached_at, 'signup', 1::bigint from fam where fam.promo_attached_at is not null
    union all
    select fam.code_id, fam.promo_attached_at, 'signup_admin', 1::bigint from fam where fam.promo_attached_at is not null and fam.promo_attached_by is not null
    union all
    -- the first successful top-up of each family
    select fam.code_id, w.ts, 'funded', 1::bigint
      from fam cross join lateral (select min(coalesce(t.decided_at, t.created_at)) as ts
                                     from public.wallet_topups t where t.profile_id = fam.id and t.status = 'successful') w
     where w.ts is not null
    union all
    -- bookings with the code (not returned), lessons discounted, rand booked
    select u.code_id, u.created_at, 'book_' || u.lesson_number::text, 1::bigint from public.promo_code_uses u where u.returned_at is null
    union all
    select u.code_id, u.created_at, 'discounted', 1::bigint from public.promo_code_uses u where u.returned_at is null
    union all
    select u.code_id, u.created_at, 'rand_booked', u.amount_off::bigint from public.promo_code_uses u where u.returned_at is null
    union all
    -- rand given: the discount on lessons that were completed
    select u.code_id, coalesce(s.completed_at, s.scheduled_start), 'rand_given', u.amount_off::bigint
      from public.promo_code_uses u
      join public.session_requests r on r.id = u.request_id
      join public.sessions s on s.id = r.resulting_session_id
     where u.returned_at is null and s.status = 'completed'
    union all
    -- uses that were returned (the discount was given back), on the day they were returned
    select u.code_id, u.returned_at, 'returned', 1::bigint from public.promo_code_uses u where u.returned_at is not null
    union all
    select u.code_id, u.returned_at, 'rand_returned', u.amount_off::bigint from public.promo_code_uses u where u.returned_at is not null
    union all
    -- the 4th booking, and the first lesson completed
    select fam.code_id, b.created_at, 'book_4', 1::bigint from fam join booked b on b.booker = fam.id and b.rn = 4
    union all
    select fam.code_id, d.ts, 'first_done', 1::bigint
      from fam cross join lateral (select min(coalesce(s.completed_at, s.scheduled_start)) as ts
                                     from public.sessions s where s.booked_by_profile_id = fam.id and s.status = 'completed') d
     where d.ts is not null
    union all
    -- the tutor bonus: paid (net of what was taken back) and held back by the floor
    select b.code_id, coalesce(b.paid_at, b.first_lesson_at), 'bonus_paid', (b.paid_rand - b.reversed_rand)::bigint from public.tutor_bonuses b where b.code_id is not null
    union all
    select b.code_id, coalesce(b.paid_at, b.first_lesson_at), 'bonus_held', (b.wanted_rand - b.paid_rand)::bigint from public.tutor_bonuses b where b.code_id is not null
    union all
    -- requests that expired with no lesson
    select fam.code_id, coalesce(r.expires_at, r.created_at), 'expired', 1::bigint
      from public.session_requests r join fam on fam.id = r.requested_by_profile_id
     where r.status = 'expired' and r.resulting_session_id is null
  ),
  ev as (
    select x.code_id, (x.ts at time zone v_tz)::date as day, x.kind, x.n
      from ev_all x
     where x.code_id is not null and x.ts is not null and (x.ts at time zone v_tz)::date between v_from and v_to
  ),
  agg as (select e.code_id, e.kind, sum(e.n)::bigint as n from ev e group by e.code_id, e.kind),
  day_agg as (select e.day, e.code_id, e.kind, sum(e.n)::bigint as n from ev e group by e.day, e.code_id, e.kind),
  ever as (select e.src, count(*)::bigint as n from public.founding_page_events e where e.event = 'code_open' group by e.src),
  base as (
    select (p.created_at at time zone v_tz)::date as day,
           count(*) filter (where p.promo_code_id is not null) as w,
           count(*) filter (where p.promo_code_id is null) as wo
      from public.profiles p
     where p.role in ('parent', 'student') and (p.created_at at time zone v_tz)::date between v_from and v_to
       and not exists (select 1 from auth.users au where au.id = p.id and nullif(au.raw_app_meta_data ->> 'created_by_guardian', '') is not null)
     group by 1
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'opens_counter', case when v_live then 'live' else 'not_live' end,
    'bonus_on', public.tutor_bonus_flag('tutor_bonus_enabled', false),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code_id', c.id, 'code', c.code, 'label', c.label, 'active', c.active, 'owner_tutor_id', c.owner_tutor_id,
               'referring_tutor_id', c.referring_tutor_id, 'created_at', c.created_at, 'opens_ever', coalesce(x.n, 0),
               'k', coalesce((select jsonb_object_agg(a.kind, a.n) from agg a where a.code_id = c.id), '{}'::jsonb)
             ) order by c.created_at desc)
        from public.promo_codes c left join ever x on x.src = lower(c.code)), '[]'::jsonb),
    'totals', coalesce((select jsonb_object_agg(k.kind, k.n) from (select a.kind, sum(a.n) as n from agg a group by a.kind) k), '{}'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'code_id', d.code_id, 'code', c.code, 'k', d.k) order by d.day, c.code)
        from (select g.day, g.code_id, jsonb_object_agg(g.kind, g.n) as k from day_agg g group by g.day, g.code_id) d
        join public.promo_codes c on c.id = d.code_id), '[]'::jsonb),
    'baseline', jsonb_build_object('with_code', coalesce((select sum(b.w) from base b), 0), 'without_code', coalesce((select sum(b.wo) from base b), 0)),
    'baseline_days', coalesce((select jsonb_agg(jsonb_build_object('day', b.day, 'with_code', b.w, 'without_code', b.wo) order by b.day) from base b), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_code_funnel(date, date) from public, anon;
grant execute on function public.admin_code_funnel(date, date) to authenticated;

-- 2. the tutor activation list ----------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_tutor_activation(p_quiet_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_quiet_days, 7), 1), 90);
  v_live boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  v_live := exists (select 1 from public.founding_page_events e where e.event = 'code_open');

  with
  opened as (select e.src, count(*)::integer as opens from public.founding_page_events e where e.event = 'code_open' group by e.src),
  firsts as (
    select f.src, count(*)::integer as visitors
      from (select distinct on (e.visitor_id) e.src from public.founding_page_events e where e.event = 'code_open' order by e.visitor_id, e.created_at, e.id) f
     group by f.src
  ),
  approvals as (
    select a.target_entity_id as tutor_id, max(a.created_at) as ts
      from public.admin_audit_logs a
     where a.action = 'tutor_approved' and a.target_entity_id is not null
     group by a.target_entity_id
  ),
  t as (
    select tp.id as tutor_id,
           nullif(btrim(coalesce(pr.full_name, '')), '') as name,
           tp.current_sub_tier_id as level,
           coalesce(ap.ts, nullif(to_jsonb(tp) ->> 'verified_at', '')::timestamptz) as approved_at,
           c.code, c.active as code_active,
           coalesce(o.opens, 0) as opens,
           coalesce(fi.visitors, 0) as visitors,
           (select count(*) from public.profiles p where p.promo_code_id = c.id)::integer as signups,
           (select count(*) from public.promo_code_uses u where u.code_id = c.id and u.returned_at is null)::integer as family_lessons,
           exists (select 1 from public.tutor_subject_competencies s where s.tutor_id = tp.id) as has_subjects,
           exists (select 1 from public.tutor_availability av where av.tutor_id = tp.id) as has_hours,
           nullif(to_jsonb(tp) ->> 'hours_saved_at', '')::timestamptz as hours_saved_at,
           tp.first_request_seen_at,
           ob.completed_at as onboarding_completed_at,
           (select count(*) from public.sessions s where s.tutor_id = tp.id)::integer as accepted,
           (select min(s.created_at) from public.sessions s where s.tutor_id = tp.id) as first_accepted_at,
           (select count(*) from public.sessions s where s.tutor_id = tp.id and s.status = 'completed')::integer as completed,
           coalesce((select sum(b.paid_rand - b.reversed_rand) from public.tutor_bonuses b where b.tutor_id = tp.id), 0)::integer as bonus_rand
      from public.tutor_profiles tp
      join public.profiles pr on pr.id = tp.id
      left join approvals ap on ap.tutor_id = tp.id
      left join public.promo_codes c on c.owner_tutor_id = tp.id
      left join opened o on o.src = lower(c.code)
      left join firsts fi on fi.src = lower(c.code)
      left join public.tutor_onboarding ob on ob.tutor_id = tp.id
     where tp.is_verified
  ),
  u as (
    select t.*,
           (select count(*) from public.sessions s where s.tutor_id = t.tutor_id and (t.approved_at is null or s.created_at >= t.approved_at))::integer as accepted_since
      from t
  ),
  w as (
    select u.*,
           case when not u.has_subjects then 'subjects'
                when not u.has_hours then 'hours'
                when u.first_request_seen_at is null then 'request_seen'
                when u.accepted = 0 then 'accept'
                when u.completed = 0 then 'complete'
           end as next_step,
           (u.approved_at is null or u.approved_at <= now() - make_interval(days => v_days)) and (not u.has_hours or u.accepted_since = 0) as quiet
      from u
  )
  select jsonb_build_object(
    'quiet_days', v_days,
    'opens_counter', case when v_live then 'live' else 'not_live' end,
    'totals', jsonb_build_object(
      'verified', count(*),
      'quiet', count(*) filter (where w.quiet),
      'with_subjects', count(*) filter (where w.has_subjects),
      'with_hours', count(*) filter (where w.has_hours),
      'saw_a_request', count(*) filter (where w.first_request_seen_at is not null),
      'accepted_one', count(*) filter (where w.accepted > 0),
      'completed_one', count(*) filter (where w.completed > 0),
      'approval_unknown', count(*) filter (where w.approved_at is null)),
    'tutors', coalesce(jsonb_agg(jsonb_build_object(
      'tutor_id', w.tutor_id, 'name', w.name, 'level', w.level, 'approved_at', w.approved_at, 'approval_known', w.approved_at is not null,
      'code', w.code, 'code_active', w.code_active, 'opens', w.opens, 'visitors', w.visitors, 'signups', w.signups, 'family_lessons', w.family_lessons,
      'has_subjects', w.has_subjects, 'has_hours', w.has_hours, 'hours_saved_at', w.hours_saved_at, 'first_request_seen_at', w.first_request_seen_at,
      'onboarding_completed_at', w.onboarding_completed_at, 'accepted', w.accepted, 'first_accepted_at', w.first_accepted_at, 'completed', w.completed,
      'bonus_rand', w.bonus_rand, 'next_step', w.next_step, 'quiet', w.quiet
    ) order by w.quiet desc, w.approved_at nulls first, w.name), '[]'::jsonb)
  ) into v_out
  from w;
  return v_out;
end;
$$;
revoke all on function public.admin_tutor_activation(integer) from public, anon;
grant execute on function public.admin_tutor_activation(integer) to authenticated;
