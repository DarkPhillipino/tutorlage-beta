-- JOB LINK (PM line 79, 25 Nov 2026): from a tutor's public page /t/CODE straight to booking that tutor.
--   NEW     session_requests.via_tutor_page: true for a request sent from a tutor's own booking page (it only changes the words of the notices).
--   NEW     display_name_part, tutor_level_basis, tutor_page_open_to, request_next_step_words (internal helpers).
--   NEW     tutor_booking_page(code), tutor_page_times(code, hours, days): signed in only; what the booking page of one tutor needs.
--   CHANGED public_tutor_page: no "checked" lines any more; answers the basis the tutor's level rests on (their own record's minimums, else their own highest
--           verified credential other than admin_assigned), the tier line only where it is true for that basis, and the code's discount; the name is capitalised.
--   CHANGED addressed_request_problem, addressed_fit_problem: any parent or learner account may address a verified tutor whose public page is on (it was: only
--           a family carrying the tutor's own code). Avoid choices, ended pairings, 3 waiting, level, subject and the fit checks are unchanged.
--   CHANGED my_linked_tutor: also answers the code; the name is capitalised.
--   CHANGED decline_session_request, expire_stale_paid_requests: a request sent from a tutor's page is never told to go to another tutor.
--   CHANGED notify_tutor_of_addressed_request: "again" only for a learner the tutor has taught.
-- The patched functions are edited in place from the text the database holds; each edit must find its anchor exactly once or the migration stops.
-- Running it twice changes nothing. UNDO: Drake/programmer/rollbacks/20261125150000_tutor_page_booking_ROLLBACK.sql

alter table public.session_requests add column if not exists via_tutor_page boolean not null default false;

-- "thandi" -> "Thandi", "mary-ann" -> "Mary-Ann": the first letter of each part becomes a capital, the rest stays as typed.
create or replace function public.display_name_part(p_name text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v text := btrim(coalesce(p_name, ''));
  v_out text := '';
  v_c text;
  v_up boolean := true;
  i integer;
begin
  for i in 1 .. length(v) loop
    v_c := substr(v, i, 1);
    v_out := v_out || case when v_up then upper(v_c) else v_c end;
    v_up := v_c in (' ', '-');
  end loop;
  return v_out;
end;
$function$;

-- What this tutor's level rests on, for the tutor's own public page. Record first: the level is above the first one and the tutor's own record meets every minimum
-- of it today. Otherwise the highest verified credential of their own that still counts (never "admin_assigned", never the list of what could reach a level).
create or replace function public.tutor_level_basis(p_tutor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  t record;
  l record;
  c record;
  v_prior numeric;
begin
  select * into t from public.tutor_profiles where id = p_tutor;
  if not found then
    return null;
  end if;
  select * into l from public.sub_tier_definitions where id = t.current_sub_tier_id;
  if not found then
    return null;
  end if;
  select coalesce(sum(hours), 0) into v_prior from public.tutor_prior_hours where tutor_id = p_tutor and removed_at is null;
  if l.id <> '1A'
     and l.min_hours <= coalesce(t.total_completed_hours, 0) + v_prior
     and l.min_rating <= coalesce(t.avg_rating, 0)
     and l.min_repeat_rate_pct <= coalesce(t.repeat_student_rate_pct, 0)
     and l.min_written_reviews <= coalesce(t.total_reviews_count, 0)
     and l.min_distinct_students_uplift <= coalesce(t.qualified_uplift_students_count, 0)
     and l.required_grade_uplift_pct <= coalesce(t.avg_grade_uplift_pct, 0)
  then
    return jsonb_build_object('kind', 'record',
      'min_hours', l.min_hours, 'min_rating', l.min_rating, 'min_repeat_rate_pct', l.min_repeat_rate_pct, 'min_reviews', l.min_written_reviews,
      'min_uplift_students', l.min_distinct_students_uplift, 'required_uplift_pct', l.required_grade_uplift_pct,
      'outside_hours', coalesce(t.total_completed_hours, 0) < l.min_hours);
  end if;
  select d.label, e.tier_id into c
    from public.tutor_credentials tc
    join public.credential_definitions d on d.code = tc.credential_code
    join public.sub_tier_definitions e on e.id = coalesce(tc.assigned_sub_tier_id, d.entry_sub_tier_id)
   where tc.tutor_id = p_tutor and tc.status = 'verified' and tc.credential_code <> 'admin_assigned'
     and (d.recency_years is null or tc.obtained_on is null or tc.obtained_on >= (current_date - make_interval(years => d.recency_years))::date)
   order by e.max_allowed_rate desc, tc.verified_at desc nulls last, d.label
   limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object('kind', 'credential', 'label', c.label, 'tier_id', c.tier_id);
end;
$function$;
revoke all on function public.tutor_level_basis(uuid) from public, anon, authenticated;

create or replace function public.public_tutor_page(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tutor uuid;
  v_code text;
  v_first text;
  v_level text;
  v_tier text;
  v_tier_id integer;
  v_line text;
  v_price numeric;
  v_cur text;
  v_hours text;
  v_basis jsonb;
  v_offer public.promo_codes;
begin
  select pc.owner_tutor_id, pc.code into v_tutor, v_code
    from public.promo_codes pc
   where pc.code = public.promo_normalise(p_code) and pc.owner_tutor_id is not null and pc.active
   limit 1;
  if v_tutor is null then return null; end if;
  if not exists (select 1 from public.tutor_public_profile x where x.tutor_id = v_tutor and x.is_public) then return null; end if;
  select s.id, t.public_name, t.id, t.positioning_quote, s.max_allowed_rate, trim(t.currency_code)
    into v_level, v_tier, v_tier_id, v_line, v_price, v_cur
    from public.tutor_profiles tp
    join public.sub_tier_definitions s on s.id = tp.current_sub_tier_id
    join public.tier_definitions t on t.id = s.tier_id
   where tp.id = v_tutor and tp.is_verified and s.id not in ('4C', '4D');
  if v_level is null then return null; end if;
  select coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'A Tutorlage tutor') into v_first from public.profiles p where p.id = v_tutor;
  v_hours := public.tutor_hours_in_words(v_tutor);
  v_basis := public.tutor_level_basis(v_tutor);
  -- The tier's line speaks of a record or a qualification. It is shown for the first tier, for a level reached by record, and where the tutor's own credential
  -- belongs to this tier; otherwise it would claim something the tutor does not hold.
  if not (v_tier_id = 1 or coalesce(v_basis ->> 'kind', '') = 'record' or coalesce((v_basis ->> 'tier_id')::integer, 0) = v_tier_id) then
    v_line := null;
  end if;
  v_offer := public.promo_find_open_code(public.promo_normalise(v_code));
  return jsonb_build_object(
    'code', v_code,
    'first_name', coalesce(public.display_name_part(v_first), 'A Tutorlage tutor'),
    'level_id', v_level,
    'level_name', v_tier,
    'tier_line', v_line,
    'price', v_price,
    'currency', v_cur,
    'basis', v_basis - 'tier_id',
    'discount', case when v_offer.id is null then null else jsonb_build_object('percent', v_offer.percent_off, 'lessons', v_offer.uses_per_account) end,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('subject', x.subject_name, 'min_grade', x.min_grade_level, 'max_grade', x.max_grade_level) order by x.subject_name, x.min_grade_level)
        from (select distinct c.subject_name, c.min_grade_level, c.max_grade_level from public.tutor_subject_competencies c
               where c.tutor_id = v_tutor and c.verification_status = 'verified') x), '[]'::jsonb),
    'hours', v_hours,
    'taking_requests', v_hours is not null,
    'photo', (select ph.photo_data from public.tutor_photo ph where ph.tutor_id = v_tutor and ph.status = 'approved'));
end;
$function$;

-- The booking page of one tutor: what the public page says, plus who to address. Signed in only.
create or replace function public.tutor_booking_page(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_page jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_page := public.public_tutor_page(p_code);
  if v_page is null then return null; end if;
  return v_page || jsonb_build_object('tutor_id',
    (select pc.owner_tutor_id from public.promo_codes pc where pc.code = v_page ->> 'code' and pc.owner_tutor_id is not null limit 1));
end;
$function$;
revoke all on function public.tutor_booking_page(text) from public, anon;
grant execute on function public.tutor_booking_page(text) to authenticated;

-- The start times the tutor can be asked for, by the same rule that refuses a request (working hours and what is already booked). Signed in only, one tutor
-- whose page is on. 'now_ok' says whether a lesson of this length could start now.
create or replace function public.tutor_page_times(p_code text, p_hours numeric default 1, p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tutor uuid;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_days integer := least(greatest(coalesce(p_days, 28), 1), 42);
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 3 or (p_hours * 2) <> trunc(p_hours * 2) then
    raise exception 'A session lasts from 1 to 3 hours, in half-hour steps.';
  end if;
  if public.public_tutor_page(p_code) is null then return null; end if;
  select pc.owner_tutor_id into v_tutor from public.promo_codes pc
   where pc.code = public.promo_normalise(p_code) and pc.owner_tutor_id is not null and pc.active limit 1;
  return jsonb_build_object(
    'now_ok', public.tutor_free_problem(v_tutor, now(), p_hours, null) is null,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(x.d, 'YYYY-MM-DD'), 'times', x.times) order by x.d)
        from (
          select day.d, array_agg(to_char(slot.at_local, 'HH24:MI') order by slot.at_local) as times
            from (select v_today + n as d from generate_series(0, v_days - 1) n) day
            cross join generate_series(0, 47) i
            cross join lateral (select day.d + make_interval(mins => i * 30) as at_local) slot
           where case
                   when not public.tutor_hours_cover(v_tutor, extract(dow from day.d)::integer, i * 30, i * 30 + 30) then false
                   when (slot.at_local at time zone 'Africa/Johannesburg') <= now() then false
                   else public.tutor_free_problem(v_tutor, slot.at_local at time zone 'Africa/Johannesburg', p_hours, null) is null
                 end
           group by day.d
        ) x), '[]'::jsonb));
end;
$function$;
revoke all on function public.tutor_page_times(text, numeric, integer) from public, anon;
grant execute on function public.tutor_page_times(text, numeric, integer) to authenticated;

-- May this payer address this tutor from the tutor's public page? Internal.
create or replace function public.tutor_page_open_to(p_tutor uuid, p_payer uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles pr where pr.id = p_payer and pr.role::text in ('parent', 'student'))
     and exists (select 1 from public.tutor_public_profile x where x.tutor_id = p_tutor and x.is_public)
     and exists (select 1 from public.tutor_profiles tp where tp.id = p_tutor and tp.is_verified);
$function$;
-- addressed_request_problem and addressed_fit_problem run as the owner, so nobody else needs to call it.
revoke all on function public.tutor_page_open_to(uuid, uuid) from public, anon, authenticated;

-- The last sentence of "your tutor can't take this one" and "your tutor didn't accept in time". Internal.
create or replace function public.request_next_step_words(p_request uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select ' You decide what happens next: choose another time on ' || public.display_name_part(split_part(btrim(coalesce(p.full_name, '')), ' ', 1)) || '''s page, tutorlage.com/t/' || pc.code || '.'
       from public.session_requests r
       join public.profiles p on p.id = r.requested_tutor_id
       join public.promo_codes pc on pc.owner_tutor_id = r.requested_tutor_id and pc.active
       join public.tutor_public_profile x on x.tutor_id = r.requested_tutor_id and x.is_public
      where r.id = p_request and r.via_tutor_page
      limit 1),
    (select ' You decide what happens next.' from public.session_requests r where r.id = p_request and r.via_tutor_page),
    ' You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.');
$function$;
revoke all on function public.request_next_step_words(uuid) from public, anon, authenticated;

do $patch$
declare
  e record;
  v_def text;
  v_hits integer;
begin
  for e in
    select * from (values
      ('public.addressed_request_problem(uuid,uuid,uuid,text,uuid,uuid)',
       $old$     and not exists (
       select 1
         from public.profiles pr
         join public.promo_codes pc on pc.id = pr.promo_code_id and pc.active and pc.owner_tutor_id = p_tutor
         join public.tutor_public_profile x on x.tutor_id = p_tutor and x.is_public
        where pr.id = p_requested_by) then$old$,
       $new$     and not public.tutor_page_open_to(p_tutor, p_requested_by) then -- JOB LINK open (25 Nov 2026)$new$),
      ('public.addressed_fit_problem(uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,numeric)',
       $old$         and not exists (
           select 1
             from public.profiles pr
             join public.promo_codes pc on pc.id = pr.promo_code_id and pc.active and pc.owner_tutor_id = p_tutor
             join public.tutor_public_profile x on x.tutor_id = p_tutor and x.is_public
            where pr.id = p_requested_by)) then$old$,
       $new$         and not public.tutor_page_open_to(p_tutor, p_requested_by)) then -- JOB LINK open (25 Nov 2026)$new$),
      ('public.my_linked_tutor()',
       $old$return jsonb_build_object('tutor_id', v_tutor, 'first_name', v_first, 'hours', public.tutor_hours_in_words(v_tutor)); -- JOB FIT hours (25 Nov 2026)$old$,
       $new$return jsonb_build_object('tutor_id', v_tutor, 'first_name', case when v_first = 'your tutor' then v_first else public.display_name_part(v_first) end, 'hours', public.tutor_hours_in_words(v_tutor), 'code', (select pc.code from public.profiles pr join public.promo_codes pc on pc.id = pr.promo_code_id where pr.id = auth.uid())); -- JOB FIT hours (25 Nov 2026) JOB LINK code (25 Nov 2026)$new$),
      ('public.decline_session_request(uuid)',
       $old$|| ' You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'$old$,
       $new$|| public.request_next_step_words(v_req.id) /* JOB LINK decline (25 Nov 2026) */$new$),
      ('public.expire_stale_paid_requests()',
       $old$|| ' You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'$old$,
       $new$|| public.request_next_step_words(req.id) /* JOB LINK expiry (25 Nov 2026) */$new$),
      ('public.notify_tutor_of_addressed_request()',
       $old$  values (new.requested_tutor_id, 'request_for_you', 'A learner asked for you again',
          'A learner you have taught sent a request addressed to you. You have up to 48 hours to accept it (never later than its session time). Open Teach to see it.');$old$,
       $new$  select new.requested_tutor_id, 'request_for_you', -- JOB LINK notice (25 Nov 2026): "again" only for a learner this tutor has taught
         case when t.taught then 'A learner asked for you again' else 'A learner asked for you' end,
         case when t.taught then 'A learner you have taught' else 'A learner' end || ' sent a request addressed to you. You have up to 48 hours to accept it (never later than its session time). Open Teach to see it.'
    from (select exists (select 1 from public.sessions s where s.student_id = new.student_id and s.tutor_id = new.requested_tutor_id and s.status = 'completed') as taught) t;$new$)
    ) as x(fn, anchor, replacement)
  loop
    v_def := replace(pg_get_functiondef(e.fn::regprocedure), E'\r\n', E'\n');
    if position(replace(e.replacement, E'\r\n', E'\n') in v_def) > 0 then
      continue;  -- already patched
    end if;
    v_hits := (length(v_def) - length(replace(v_def, replace(e.anchor, E'\r\n', E'\n'), ''))) / length(replace(e.anchor, E'\r\n', E'\n'));
    if v_hits <> 1 then
      raise exception 'JOB LINK: anchor found % times in %', v_hits, e.fn;
    end if;
    execute replace(v_def, replace(e.anchor, E'\r\n', E'\n'), replace(e.replacement, E'\r\n', E'\n'));
  end loop;
end $patch$;
