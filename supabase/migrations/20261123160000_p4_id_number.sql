-- 2026-11-23, P4-3 (PM line 46, job L): the ID NUMBER checked, the date of birth derived, the NUMBER NEVER KEPT; and the name on the ID compared with the profile as an "ask".
-- ADDITIVE: three new functions. Nothing existing changes (admin_set_date_of_birth stays: it is the path for passports, which have no such number).
-- A South African ID number is 13 digits: YYMMDD, four digits, a citizenship digit (0 citizen, 1 permanent resident), one more, and a check digit (Luhn over all 13).
-- That proves TYPING ACCURACY only; whether the number belongs to this person stays the officer's human look at the document.
--   admin_check_id_number(p_id)  STABLE, touches no table: returns {ok, reason, dob, age_years, adult, citizenship}. reason: not_13_digits, bad_check_digit, bad_date, not_plausible. For the officer to CONFIRM the derived date.
--   admin_set_date_of_birth_from_id(p_profile, p_id, p_expected_dob)  re-derives the date from the number, requires it to equal the date the officer confirmed, stores ONLY the date, and writes the same
--       'date_of_birth_recorded' audit line as the manual path with {"source":"id_number"}. The number is never stored, never put in an audit line, never in an error or notice text.
--   admin_name_check(p_profile, p_printed_name)  STABLE: compares the name as printed with the profile's name (case, accents, hyphens and spacing ignored; middle names allowed): returns {result: 'match'|'ask'}.
--       It saves nothing and refuses nothing: a different name (a married surname) is a question for the officer, not a rejection. The typed name is not kept.
-- Where the number could leak, and what this does about each: it is a function ARGUMENT, so (a) a failing call logs the statement text with $1 placeholders, never the value (log_parameter_max_length_on_error = 0);
-- (b) no message raised here contains it; (c) nothing is audited with it; (d) the client error log scrubs any run of 9 or more digits anyway. The admin screen must not keep it in state or in the address bar.
-- Roles: verification officer and super admin (as admin_set_date_of_birth since slice A). Rollback: Drake/programmer/rollbacks/20261123160000_p4_id_number_ROLLBACK.sql. Test: supabase/tests/p4_id_number.sql.

create or replace function public.admin_check_id_number(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := regexp_replace(coalesce(p_id, ''), '[ -]', '', 'g');
  i integer; d integer; s integer := 0;
  yy integer; mm integer; dd integer; y integer;
  v_dob date; v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can check an ID number' using errcode = '42501'; end if;
  if v !~ '^[0-9]{13}$' then return jsonb_build_object('ok', false, 'reason', 'not_13_digits'); end if;
  -- Luhn over all 13 digits: from the right, every second digit is doubled
  for i in 1..13 loop
    d := substr(v, 14 - i, 1)::integer;
    if i % 2 = 0 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    s := s + d;
  end loop;
  if s % 10 <> 0 then return jsonb_build_object('ok', false, 'reason', 'bad_check_digit'); end if;
  yy := substr(v, 1, 2)::integer; mm := substr(v, 3, 2)::integer; dd := substr(v, 5, 2)::integer;
  -- the century that puts the person in the past and within a human lifetime: 20YY if not in the future, else 19YY
  y := case when make_date_safe(2000 + yy, mm, dd) is not null and make_date_safe(2000 + yy, mm, dd) <= v_today then 2000 + yy else 1900 + yy end;
  v_dob := make_date_safe(y, mm, dd);
  if v_dob is null then return jsonb_build_object('ok', false, 'reason', 'bad_date'); end if;
  if v_dob > v_today or v_dob < (v_today - interval '110 years')::date then return jsonb_build_object('ok', false, 'reason', 'not_plausible'); end if;
  return jsonb_build_object('ok', true, 'dob', v_dob, 'age_years', date_part('year', age(v_today, v_dob))::integer,
                            'adult', v_dob <= (v_today - interval '18 years')::date,
                            'citizenship', case substr(v, 11, 1) when '0' then 'citizen' when '1' then 'permanent_resident' else 'other' end);
end;
$$;

-- a real calendar date or null (no error, so no value can end up in a message)
create or replace function public.make_date_safe(y integer, m integer, d integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
begin
  return make_date(y, m, d);
exception when others then
  return null;
end;
$$;

create or replace function public.admin_set_date_of_birth_from_id(p_profile uuid, p_id text, p_expected_dob date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb;
  v_previous date;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can record a date of birth' using errcode = '42501'; end if;
  c := public.admin_check_id_number(p_id);
  if not (c ->> 'ok')::boolean then
    raise exception 'The ID number is not valid (%): check it against the document', c ->> 'reason';
  end if;
  if (c ->> 'dob')::date is distinct from p_expected_dob then
    raise exception 'The date you confirmed does not match the number: check it again';
  end if;
  if not public.is_plausible_date_of_birth((c ->> 'dob')::date) then raise exception 'Enter a real date of birth'; end if;
  select date_of_birth into v_previous from public.profiles where id = p_profile;
  if not found then raise exception 'No such profile'; end if;
  update public.profiles set date_of_birth = (c ->> 'dob')::date where id = p_profile;
  insert into public.admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, metadata)
  values (auth.uid(), 'date_of_birth_recorded', 'profiles', p_profile, jsonb_build_object('was_already_recorded', v_previous is not null, 'source', 'id_number'));
  return jsonb_build_object('adult', (c ->> 'adult')::boolean, 'age_years', (c ->> 'age_years')::integer);
end;
$$;

-- names: lower case, accents folded, hyphens and punctuation to spaces, split into words
create or replace function public.name_words(p text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(w order by w), '{}') from (
    select distinct w from unnest(string_to_array(btrim(regexp_replace(
      translate(lower(coalesce(p, '')), 'àáâãäåèéêëìíîïòóôõöùúûüýÿçñšž', 'aaaaaaeeeeiiiiooooouuuuyycnsz'), '[^a-z]+', ' ', 'g')), ' ')) w where w <> ''
  ) x
$$;

create or replace function public.admin_name_check(p_profile uuid, p_printed_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a text[]; b text[];
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can compare names' using errcode = '42501'; end if;
  select public.name_words(full_name) into a from public.profiles where id = p_profile;
  if a is null then raise exception 'No such profile'; end if;
  b := public.name_words(p_printed_name);
  if coalesce(array_length(b, 1), 0) = 0 then raise exception 'Type the name as it is printed on the document'; end if;
  -- every word of the profile name is in the printed name (a printed middle name is fine), or the other way round (the profile holds more than the document)
  return jsonb_build_object('result', case when coalesce(array_length(a, 1), 0) > 0 and (a <@ b or b <@ a) then 'match' else 'ask' end);
end;
$$;

revoke all on function public.make_date_safe(integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.name_words(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_check_id_number(text) from public, anon, service_role;
revoke all on function public.admin_set_date_of_birth_from_id(uuid, text, date) from public, anon, service_role;
revoke all on function public.admin_name_check(uuid, text) from public, anon, service_role;
grant execute on function public.admin_check_id_number(text) to authenticated;
grant execute on function public.admin_set_date_of_birth_from_id(uuid, text, date) to authenticated;
grant execute on function public.admin_name_check(uuid, text) to authenticated;
