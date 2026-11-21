-- P5-b (CEO, 21 Nov 2026): say WHY no tutor is shown, and WHEN one is.
-- ADDITIVE and READ-ONLY: one new function, no table, no column, no policy, no data change. Nothing else is replaced. Undo: drop function
-- public.no_tutor_reason(text, text, timestamptz, numeric, text);
--
-- It answers, for what a learner has chosen (subject, grade, the day and length of the lesson, optionally the price level as a floor):
--   {"case":"ok",           "windows":[]}   a tutor can take it as chosen (nothing to explain);
--   {"case":"no_subject",   "windows":[]}   no tutor at all teaches this (verified, approved for the subject and grade, level at or above the floor);
--   {"case":"fully_booked", "windows":[]}   tutors teach it but none has an open window in the next 14 days that fits the lesson;
--   {"case":"other_time",   "windows":[{date, from, end_date, to, place}, ...]}   tutors are open, just not then: the next open windows, soonest
--                                           first, at most 5, within 14 days, times in South African time, place "online".
-- It returns time frames only: never a name, a count, an id or a profile (matching stays anonymous).
--
-- THE SAME RULES AS MATCHING. The eligible tutors are chosen exactly as available_price_levels (the count the price screen shows) chooses
-- them: verified, level not frozen (except for the rating-drop freeze), tutor_qualifies(subject, grade) with the widened rule (school and
-- curriculum are not used, as in the count and in a request after the first 5 minutes), plus the optional floor (the tutor's level rate is
-- at or above the chosen level's). "Free" is tutor_free_for itself for the chosen time. An open window is built from the tutor's weekly
-- working hours (touching blocks join, as tutor_hours_cover does) minus their sessions that are pending_confirmation, scheduled or
-- in_progress and the requests they are being charged for (as tutor_free_problem does), and a window's edge may touch a booked session
-- (tutor_free_problem refuses only a real overlap). A window is shown only if one single tutor is open for the whole lesson length, and
-- never starts before the next half hour. Today every lesson is online (every tutor teaches online and a request carries no place), so the
-- place is "online".
create or replace function public.no_tutor_reason(
  p_subject text,
  p_grade text,
  p_start timestamptz,
  p_hours numeric,
  p_min_sub_tier text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_tz constant text := 'Africa/Johannesburg';
  v_floor numeric;
  v_ids uuid[];
  v_now timestamptz := now();
  v_first timestamptz := to_timestamp(ceil(extract(epoch from now()) / 1800) * 1800);   -- the next half hour
  v_horizon timestamptz := now() + interval '14 days';
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_len interval;
  v_ws timestamptz[] := '{}';
  v_we timestamptz[] := '{}';
  b record;
  x record;
  v_pos timestamptz;
  v_s timestamptz;
  v_windows jsonb;
begin
  if p_min_sub_tier is not null then
    select s.max_allowed_rate into v_floor from public.sub_tier_definitions s where s.id = p_min_sub_tier;
  end if;

  v_ids := array(
    select tp.id
      from public.tutor_profiles tp
      join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
     where tp.is_verified
       and not (coalesce(tp.tier_frozen, false) and tp.freeze_reason is distinct from 'Average rating dropped below 4.70 threshold.')
       and (v_floor is null or st.max_allowed_rate >= v_floor)
       and public.tutor_qualifies(tp.id, p_subject, p_grade, null, null)
  );
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('case', 'no_subject', 'windows', '[]'::jsonb);
  end if;

  -- No time asked for: nothing to explain.
  if p_start is null or p_hours is null or p_hours <= 0 then
    return jsonb_build_object('case', 'ok', 'windows', '[]'::jsonb);
  end if;
  if exists (select 1 from unnest(v_ids) i where public.tutor_free_for(i, p_start, p_hours)) then
    return jsonb_build_object('case', 'ok', 'windows', '[]'::jsonb);
  end if;

  v_len := p_hours::float8 * interval '1 hour';

  -- Each eligible tutor's working hours for the next 15 local days, touching blocks joined into one; then their booked times cut out.
  for b in
    with days as (
      select g::date as d from generate_series(v_today, v_today + 14, interval '1 day') g
    ), blocks as (
      select a.tutor_id as t,
             ((d.d + a.start_time) at time zone c_tz) as bs,
             ((d.d + a.end_time) at time zone c_tz) as be
        from days d
        join public.tutor_availability a
          on a.tutor_id = any (v_ids)
         and a.day_of_week = extract(dow from d.d)::integer
         and a.end_time > a.start_time
    ), marked as (
      select t, bs, be,
             case when bs <= max(be) over (partition by t order by bs, be rows between unbounded preceding and 1 preceding) then 0 else 1 end as new_island
        from blocks
    ), islands as (
      select t, bs, be, sum(new_island) over (partition by t order by bs, be) as island from marked
    )
    select t, min(bs) as bs, max(be) as be from islands group by t, island order by t, min(bs)
  loop
    v_pos := b.bs;
    for x in
      select u.s, u.e
        from (
          select s.scheduled_start as s, s.scheduled_start + (s.duration_hours::float8 * interval '1 hour') as e
            from public.sessions s
           where s.tutor_id = b.t and s.status in ('pending_confirmation', 'scheduled', 'in_progress')
          union all
          select greatest(r.requested_start, coalesce(r.claimed_at, r.requested_start)),
                 greatest(r.requested_start, coalesce(r.claimed_at, r.requested_start)) + (r.duration_hours::float8 * interval '1 hour')
            from public.session_requests r
           where r.tutor_id = b.t and r.status = 'pending' and r.payment_status = 'charging'
        ) u
       where u.s < b.be and u.e > b.bs
       order by u.s
    loop
      if x.s > v_pos then
        v_s := to_timestamp(ceil(extract(epoch from greatest(v_pos, v_first)) / 1800) * 1800);
        if v_s < v_horizon and x.s - v_s >= v_len then v_ws := v_ws || v_s; v_we := v_we || x.s; end if;
      end if;
      v_pos := greatest(v_pos, x.e);
    end loop;
    if v_pos < b.be then
      v_s := to_timestamp(ceil(extract(epoch from greatest(v_pos, v_first)) / 1800) * 1800);
      if v_s < v_horizon and b.be - v_s >= v_len then v_ws := v_ws || v_s; v_we := v_we || b.be; end if;
    end if;
  end loop;

  -- Soonest first, at most 5; a window inside a bigger one is left out (the bigger one already says it).
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(q.s at time zone c_tz, 'YYYY-MM-DD'),
           'from', to_char(q.s at time zone c_tz, 'HH24:MI'),
           'end_date', to_char((q.e - interval '1 second') at time zone c_tz, 'YYYY-MM-DD'),
           'to', case when to_char(q.e at time zone c_tz, 'HH24:MI') = '00:00' then '24:00' else to_char(q.e at time zone c_tz, 'HH24:MI') end,
           'place', 'online') order by q.s, q.e), '[]'::jsonb)
    into v_windows
    from (
      select distinct w.s, w.e
        from unnest(v_ws, v_we) as w(s, e)
       where not exists (
         select 1 from unnest(v_ws, v_we) as o(s, e)
          where o.s <= w.s and o.e >= w.e and (o.s, o.e) is distinct from (w.s, w.e)
       )
       order by w.s, w.e
       limit 5
    ) q;

  if jsonb_array_length(v_windows) = 0 then
    return jsonb_build_object('case', 'fully_booked', 'windows', '[]'::jsonb);
  end if;
  return jsonb_build_object('case', 'other_time', 'windows', v_windows);
end;
$$;

revoke all on function public.no_tutor_reason(text, text, timestamptz, numeric, text) from public, anon;
grant execute on function public.no_tutor_reason(text, text, timestamptz, numeric, text) to authenticated;
