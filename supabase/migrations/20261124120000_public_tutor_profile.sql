-- 2026-11-24, JOB P SLICE 1 (PM line 53, CEO): a tutor-owned PUBLIC PAGE, /t/CODE. The tutor chooses whether it is public (default OFF, an explicit consent); a visitor with the link sees
-- the first name only, the verified subjects and grades, the level and its price, the "checked" lines (computed LIVE, never stored), the weekly hours in words and whether she takes requests.
-- NO photo, NO intro, NO surname, NO contact, NO learner data, NO ratings. ADDITIVE: one table, one public function, one tutor function pair, two internal helpers.
-- THE CHECKED LINES (the PM's wording rule, line 44): "ID checked" (an identity document with status verified); "Results or qualification checked" (a verified matric certificate, university transcript,
--   teaching qualification or subject results); "Police clearance checked, <Month Year>" ONLY while the certificate was issued within the last 6 months (the same 6-month window as tutor_readiness; Month Year
--   is the month it was ISSUED). The words "vetted", "certified" and "background-checked" are never produced (the suite greps the whole answer for them).
-- WHO SEES WHAT: public_tutor_page(code) is callable by anyone (anon too) and answers null for an unknown code, a code that is not a tutor's, a tutor who has not switched the page on, one who has
--   switched it off, and one who is not verified: the SAME empty answer for all of them, so nobody can find out who exists. The table itself is closed to the app; the tutor reads and changes her own
--   switch only through my_public_profile() and set_my_public_profile(boolean). Switching on needs: verified, a code, and a level that is shown to families (the hidden Tier 4 levels cannot).
-- WITHDRAWAL: switching off hides the page at once (the next answer is empty); consent_at and withdrawn_at are both kept as the record.
-- Rollback: Drake/programmer/rollbacks/20261124120000_public_tutor_profile_ROLLBACK.sql. Test: supabase/tests/public_tutor_profile.sql.

create table if not exists public.tutor_public_profile (
  tutor_id uuid primary key references public.tutor_profiles(id) on delete cascade,
  is_public boolean not null default false,
  consent_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.tutor_public_profile enable row level security;
revoke all on table public.tutor_public_profile from public, anon, authenticated, service_role;

-- a time as a person says it: 5pm, 8:30am, midnight
create or replace function public.say_time(p_t time)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when extract(hour from p_t)::int in (0, 24) and extract(minute from p_t)::int = 0 then 'midnight'
    else ((case when extract(hour from p_t)::int % 12 = 0 then 12 else extract(hour from p_t)::int % 12 end)::text
          || case when extract(minute from p_t)::int = 0 then '' else ':' || lpad(extract(minute from p_t)::int::text, 2, '0') end
          || case when extract(hour from p_t)::int >= 12 then 'pm' else 'am' end)
  end;
$$;
revoke all on function public.say_time(time) from public, anon, authenticated, service_role;

-- the weekly hours in words: "Monday to Friday, 5pm to 11pm; Saturday and Sunday, 8am to 5pm". Never shows booked times. null when she has no hours.
create or replace function public.tutor_hours_in_words(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_names constant text[] := array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  g record;
  v_days integer[];
  v_out text[] := '{}';
  v_text text;
  v_runs text[];
  v_start integer;
  v_prev integer;
  v_i integer;
  v_d integer;
begin
  for g in
    with per_day as (
      select case when a.day_of_week = 0 then 7 else a.day_of_week end as d,
             string_agg(public.say_time(a.start_time) || ' to ' || public.say_time(a.end_time), ' and ' order by a.start_time) as s
        from public.tutor_availability a
       where a.tutor_id = p_tutor and a.end_time > a.start_time
       group by 1
    )
    select s, array_agg(d order by d) as days, min(d) as first_day from per_day group by s order by min(d)
  loop
    v_days := g.days;
    if array_length(v_days, 1) = 7 then
      v_text := 'Every day';
    else
      v_runs := '{}';
      v_start := v_days[1];
      v_prev := v_days[1];
      for v_i in 2 .. coalesce(array_length(v_days, 1), 0) + 1 loop
        v_d := case when v_i <= array_length(v_days, 1) then v_days[v_i] else null end;
        if v_d is not null and v_d = v_prev + 1 then
          v_prev := v_d;
        else
          v_runs := array_append(v_runs, case
            when v_prev - v_start >= 2 then c_names[v_start] || ' to ' || c_names[v_prev]
            when v_prev - v_start = 1 then c_names[v_start] || ' and ' || c_names[v_prev]
            else c_names[v_start] end);
          v_start := v_d;
          v_prev := v_d;
        end if;
      end loop;
      if array_length(v_runs, 1) = 1 then
        v_text := v_runs[1];
      else
        v_text := array_to_string(v_runs[1 : array_length(v_runs, 1) - 1], ', ') || ' and ' || v_runs[array_length(v_runs, 1)];
      end if;
    end if;
    v_out := array_append(v_out, v_text || ', ' || g.s);
  end loop;
  if array_length(v_out, 1) is null then return null; end if;
  return array_to_string(v_out, '; ');
end;
$$;
revoke all on function public.tutor_hours_in_words(uuid) from public, anon, authenticated, service_role;

-- the checked lines, live
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
  v_oldest date := ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date;
  v_police date;
begin
  if exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p_tutor and d.document_type::text = 'identity_doc' and d.status::text = 'verified') then
    v_out := array_append(v_out, 'ID checked');
  end if;
  if exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p_tutor and d.status::text = 'verified'
              and d.document_type::text in ('matric_certificate', 'university_transcript', 'teaching_qualification', 'subject_results')) then
    v_out := array_append(v_out, 'Results or qualification checked');
  end if;
  select max(d.issued_on) into v_police from public.tutor_verification_documents d
   where d.tutor_id = p_tutor and d.document_type::text = 'police_clearance' and d.status::text = 'verified'
     and d.issued_on is not null and d.issued_on <= v_today and d.issued_on >= v_oldest;
  if v_police is not null then
    v_out := array_append(v_out, 'Police clearance checked, ' || to_char(v_police, 'FMMonth YYYY'));
  end if;
  return v_out;
end;
$$;
revoke all on function public.tutor_checked_lines(uuid) from public, anon, authenticated, service_role;

-- the public answer
create or replace function public.public_tutor_page(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_code text;
  v_first text;
  v_level text;
  v_tier text;
  v_price numeric;
  v_cur text;
  v_hours text;
begin
  select pc.owner_tutor_id, pc.code into v_tutor, v_code
    from public.promo_codes pc
   where pc.code = public.promo_normalise(p_code) and pc.owner_tutor_id is not null and pc.active
   limit 1;
  if v_tutor is null then return null; end if;
  if not exists (select 1 from public.tutor_public_profile x where x.tutor_id = v_tutor and x.is_public) then return null; end if;
  select s.id, t.public_name, s.max_allowed_rate, trim(t.currency_code)
    into v_level, v_tier, v_price, v_cur
    from public.tutor_profiles tp
    join public.sub_tier_definitions s on s.id = tp.current_sub_tier_id
    join public.tier_definitions t on t.id = s.tier_id
   where tp.id = v_tutor and tp.is_verified and s.id not in ('4C', '4D');
  if v_level is null then return null; end if;
  select coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'A Tutorlage tutor') into v_first from public.profiles p where p.id = v_tutor;
  v_hours := public.tutor_hours_in_words(v_tutor);
  return jsonb_build_object(
    'code', v_code,
    'first_name', coalesce(v_first, 'A Tutorlage tutor'),
    'level_id', v_level,
    'level_name', v_tier,
    'price', v_price,
    'currency', v_cur,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('subject', x.subject_name, 'min_grade', x.min_grade_level, 'max_grade', x.max_grade_level) order by x.subject_name, x.min_grade_level)
        from (select distinct c.subject_name, c.min_grade_level, c.max_grade_level from public.tutor_subject_competencies c
               where c.tutor_id = v_tutor and c.verification_status = 'verified') x), '[]'::jsonb),
    'checked', to_jsonb(public.tutor_checked_lines(v_tutor)),
    'hours', v_hours,
    'taking_requests', v_hours is not null);
end;
$$;
revoke all on function public.public_tutor_page(text) from public;
grant execute on function public.public_tutor_page(text) to anon, authenticated;

-- the tutor's own switch
create or replace function public.my_public_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
  v_ok boolean;
  v_on boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then return jsonb_build_object('is_tutor', false); end if;
  select pc.code into v_code from public.promo_codes pc where pc.owner_tutor_id = auth.uid() and pc.active limit 1;
  select exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid() and tp.is_verified and tp.current_sub_tier_id not in ('4C', '4D')) and v_code is not null into v_ok;
  select coalesce((select x.is_public from public.tutor_public_profile x where x.tutor_id = auth.uid()), false) into v_on;
  return jsonb_build_object('is_tutor', true, 'code', v_code, 'can_be_public', v_ok, 'is_public', v_on and v_ok);
end;
$$;
revoke all on function public.my_public_profile() from public, anon;
grant execute on function public.my_public_profile() to authenticated;

create or replace function public.set_my_public_profile(p_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_me := public.my_public_profile();
  if coalesce((v_me ->> 'is_tutor')::boolean, false) is not true then raise exception 'Only a tutor has a public page' using errcode = '42501'; end if;
  if p_public is true then
    if coalesce((v_me ->> 'can_be_public')::boolean, false) is not true then
      raise exception 'Your page can be switched on once you are approved and have your code';
    end if;
    insert into public.tutor_public_profile (tutor_id, is_public, consent_at, withdrawn_at, updated_at) values (auth.uid(), true, now(), null, now())
    on conflict (tutor_id) do update set is_public = true, consent_at = now(), withdrawn_at = null, updated_at = now();
  else
    insert into public.tutor_public_profile (tutor_id, is_public, withdrawn_at, updated_at) values (auth.uid(), false, null, now())
    on conflict (tutor_id) do update set is_public = false, withdrawn_at = case when public.tutor_public_profile.is_public then now() else public.tutor_public_profile.withdrawn_at end, updated_at = now();
  end if;
end;
$$;
revoke all on function public.set_my_public_profile(boolean) from public, anon;
grant execute on function public.set_my_public_profile(boolean) to authenticated;
