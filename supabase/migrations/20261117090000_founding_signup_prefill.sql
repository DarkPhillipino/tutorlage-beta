-- THE WAITING LIST IS THE FIRST STAGE OF SIGN-UP (CEO's order of 17 Nov 2026; the PM line of that name at the end of Drake/programmer/pm-instructions.md).
-- A person who joins the founding tutors list gives their details there, once. When their place opens, the second message carries a personal link,
-- tutorlage.com/signup/tutor?k=<token>, and the sign-up form opens already filled in; the only thing they type is the password they choose.
--
-- WHAT THIS MIGRATION ADDS (additive: nothing that exists is dropped, no existing column changes, no existing row changes except getting its link token):
--   NEW  columns on public.founding_tutors_list (all nullable): first_name, surname, date_of_birth, signup_token
--        (signup_token: 32 hex characters from one random uuid, unique, given to every row made by the form or by an admin, today's two included; the table still has no
--         grant and no policy for any API role, so the new columns are as private as the rest)
--   NEW  table  public.founding_signup_lookups   one row per lookup that found nothing, no personal data (the rate limit's memory; rows older than a day are removed by the lookup itself)
--   NEW  function founding_signup_prefill(text)   anon + authenticated: the sign-up page's one call. Returns ONLY first name, surname, email, phone and date of birth, or null.
--   NEW  function admin_founding_signup_links()   verification officer or super admin: the id and token of every entry, so the admin app can build each person's message
--   REPLACED function join_founding_list(jsonb)   (the public join form's call; same name, same arguments, same answers, same limits). It now also takes first_name, surname and
--        date_of_birth. A payload from a page that was already open before this change (full_name + the 18-or-over tick, no date of birth) is still accepted exactly as before,
--        so a person who loaded the old form can still join. Under 18 is refused from the date of birth, in South African time, the way the sign-up refuses it.
-- NOT TOUCHED: admin_founding_entries and every other function, the sign-up trigger, the Teach gate, the tutor_profiles triggers, any policy.
-- WHAT THE LINK DOES NOT DO: it carries no name, age or email (only the token); it opens nothing but the sign-up form's fields; it stops working the moment an account exists for the row
-- (by account link or by the email on the row); a bad, used or unknown token gives null and the page shows the normal empty sign-up. The two ticks (Terms, and the 18-or-over by
-- date of birth) stay the person's own acts: nothing here pre-ticks anything.
-- RATE LIMIT: 60 lookups that found nothing in any 10 minutes, for the whole site, then every lookup answers null until the window clears (a circuit breaker: the page falls back
-- to the empty sign-up, which still works). A token is 122 random bits, so guessing one is hopeless either way; the limit keeps a hammering script cheap and quiet.

-- 1. the columns --------------------------------------------------------------------------------------------------------------------------------
alter table public.founding_tutors_list add column if not exists first_name text;
alter table public.founding_tutors_list add column if not exists surname text;
alter table public.founding_tutors_list add column if not exists date_of_birth date;
alter table public.founding_tutors_list add column if not exists signup_token text;

-- Today's rows (and any other row from the form or an admin) get their link token. Backfill rows are existing tutor accounts: no link is needed. Safe to run twice.
update public.founding_tutors_list set signup_token = replace(gen_random_uuid()::text, '-', '')
 where signup_token is null and source in ('form', 'admin');
alter table public.founding_tutors_list alter column signup_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.founding_tutors_list drop constraint if exists founding_list_signup_token_shape;
alter table public.founding_tutors_list add constraint founding_list_signup_token_shape check (signup_token is null or signup_token ~ '^[0-9a-f]{32}$');
create unique index if not exists founding_tutors_list_signup_token_idx on public.founding_tutors_list (signup_token) where signup_token is not null;

-- 2. the rate limit's memory --------------------------------------------------------------------------------------------------------------------
create table if not exists public.founding_signup_lookups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
create index if not exists founding_signup_lookups_created_idx on public.founding_signup_lookups (created_at desc);
alter table public.founding_signup_lookups enable row level security;
revoke all on public.founding_signup_lookups from public, anon, authenticated, service_role;

-- 3. the join form's call -----------------------------------------------------------------------------------------------------------------------
-- The text below is the live function (checked against production on 17 Nov 2026, md5 f63be620a03aa1e83f5c48e22395d402) with the date-of-birth path added; every
-- check, message, limit and the bot trap are as they were. The new path is used when the payload has first_name or date_of_birth; otherwise the old path runs unchanged.
create or replace function public.join_founding_list(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_cap constant integer := 200;
  v_name text;
  v_code text;
  v_wa text;
  v_email text;
  v_subjects jsonb := '[]'::jsonb;
  v_el jsonb;
  v_subj text;
  v_min text;
  v_max text;
  v_min_o numeric;
  v_max_o numeric;
  v_avail text[];
  v_practicum text;
  v_police text;
  v_reach text;
  v_prior text;
  v_heard text;
  v_src text;
  v_visitor uuid;
  v_n integer;
  v_new boolean;
  v_first text;
  v_surname text;
  v_dob_txt text;
  v_dob date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_age integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Something went wrong. Please try again.' using errcode = '22023';
  end if;

  -- the bot trap
  if coalesce(btrim(p ->> 'website'), '') <> '' then return jsonb_build_object('ok', true); end if;
  if (case when coalesce(p ->> 'elapsed_ms', '') ~ '^[0-9]{1,9}$' then (p ->> 'elapsed_ms')::bigint < 4000 else true end) then
    return jsonb_build_object('ok', true);
  end if;

  v_first := btrim(coalesce(p ->> 'first_name', ''), E' \t\r\n');
  v_new := v_first <> '' or btrim(coalesce(p ->> 'date_of_birth', ''), E' \t\r\n') <> '';

  if v_new then
    -- the new form: first name, surname and date of birth (the same three the sign-up asks)
    if char_length(v_first) < 1 or char_length(v_first) > 50 or v_first ~ '[<>[:cntrl:]]' then
      raise exception 'Please enter your first name.' using errcode = '22023';
    end if;
    v_surname := btrim(coalesce(p ->> 'surname', ''), E' \t\r\n');
    if char_length(v_surname) < 1 or char_length(v_surname) > 50 or v_surname ~ '[<>[:cntrl:]]' then
      raise exception 'Please enter your surname.' using errcode = '22023';
    end if;
    v_name := v_first || ' ' || v_surname;
  else
    v_name := btrim(coalesce(p ->> 'full_name', ''), E' \t\r\n');
    if char_length(v_name) < 2 or char_length(v_name) > 100 or v_name ~ '[<>[:cntrl:]]' then
      raise exception 'Please enter your full name.' using errcode = '22023';
    end if;
  end if;

  -- the name for the personal link: still asked, but on the new form it may be left empty and then is the first name
  v_code := btrim(coalesce(p ->> 'code_name', ''), E' \t\r\n');
  if v_code = '' and v_new then v_code := left(v_first, 30); end if;
  if char_length(v_code) < 1 or char_length(v_code) > 30 or v_code ~ '[<>[:cntrl:]]' then
    raise exception 'Please enter the name you want on your personal link (a first name or nickname).' using errcode = '22023';
  end if;
  v_wa := public.tidy_za_mobile(p ->> 'whatsapp');
  if v_wa is null then
    raise exception 'Please enter a South African WhatsApp number, for example 082 123 4567.' using errcode = '22023';
  end if;
  v_email := lower(btrim(coalesce(p ->> 'email', ''), E' \t\r\n'));
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter the email you will use to sign up.' using errcode = '22023';
  end if;

  if v_new then
    -- the date of birth, in South African time: a real date, a person (under 120), and 18 or older
    v_dob_txt := btrim(coalesce(p ->> 'date_of_birth', ''), E' \t\r\n');
    if v_dob_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Please enter your real date of birth.' using errcode = '22023';
    end if;
    begin
      v_dob := v_dob_txt::date;
    exception when others then
      v_dob := null;
    end;
    if v_dob is null or v_dob > v_today or v_dob < date '1900-01-01' then
      raise exception 'Please enter your real date of birth.' using errcode = '22023';
    end if;
    v_age := extract(year from age(v_today, v_dob))::integer;
    if v_age >= 120 then
      raise exception 'Please enter your real date of birth.' using errcode = '22023';
    end if;
    if v_age < 18 then
      raise exception 'You must be 18 or older to join the list.' using errcode = '22023';
    end if;
  elsif coalesce(p ->> 'is_adult', '') <> 'true' then
    raise exception 'You must be 18 or older to join the list.' using errcode = '22023';
  end if;

  if coalesce(p ->> 'consent_contact', '') <> 'true' then
    raise exception 'Please tick the box that lets us contact you about your place on the list.' using errcode = '22023';
  end if;

  -- subjects and grades: names as the app's own lists spell them
  if (case when jsonb_typeof(p -> 'subjects') = 'array' then jsonb_array_length(p -> 'subjects') else 0 end) not between 1 and 12 then
    raise exception 'Please pick at least one subject and its grades (up to 12).' using errcode = '22023';
  end if;
  for v_el in select value from jsonb_array_elements(p -> 'subjects') loop
    select s.name into v_subj from public.subjects s where lower(s.name) = lower(btrim(coalesce(v_el ->> 'subject', ''))) limit 1;
    select g.name, g.sort_order into v_min, v_min_o from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(v_el ->> 'min_grade', ''))) limit 1;
    select g.name, g.sort_order into v_max, v_max_o from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(v_el ->> 'max_grade', ''))) limit 1;
    if v_subj is null or v_min is null or v_max is null or v_min_o > v_max_o then
      raise exception 'Please pick each subject and its grades from the lists.' using errcode = '22023';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_subjects) x where x ->> 'subject' = v_subj and x ->> 'min_grade' = v_min and x ->> 'max_grade' = v_max) then
      v_subjects := v_subjects || jsonb_build_array(jsonb_build_object('subject', v_subj, 'min_grade', v_min, 'max_grade', v_max));
    end if;
  end loop;

  select coalesce(array_agg(distinct a order by a), '{}'::text[]) into v_avail
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'availability') = 'array' then p -> 'availability' else '[]'::jsonb end) a
  where a in ('evenings', 'weekends', 'holidays');

  v_practicum := p ->> 'practicum';
  if v_practicum is null or v_practicum not in ('none', 'one', 'two', 'three_plus') then
    raise exception 'Please say how much school-based teaching practice you have passed.' using errcode = '22023';
  end if;
  v_police := p ->> 'police_clearance';
  if v_police is null or v_police not in ('have', 'applied', 'not_yet') then
    raise exception 'Please say where you are with your police clearance.' using errcode = '22023';
  end if;
  v_reach := p ->> 'parent_reach';
  if v_reach is null or v_reach not in ('none', 'up_to_10', '10_to_30', 'over_30') or coalesce(p ->> 'parent_reach_willing', '') not in ('true', 'false') then
    raise exception 'Please answer the question about parents you could tell.' using errcode = '22023';
  end if;
  v_prior := nullif(btrim(coalesce(p ->> 'prior_tutoring', ''), E' \t\r\n'), '');
  if v_prior is not null and (char_length(v_prior) > 300 or v_prior ~ '[<>]') then
    raise exception 'Please keep what you tell us about tutoring to 300 characters.' using errcode = '22023';
  end if;
  v_heard := nullif(p ->> 'heard_from', '');
  if v_heard is not null and v_heard not in ('message', 'friend', 'other') then v_heard := null; end if;
  v_src := lower(btrim(coalesce(p ->> 'src', '')));
  if v_src !~ '^[a-z0-9_-]{1,32}$' then v_src := null; end if;
  if coalesce(p ->> 'visitor', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_visitor := (p ->> 'visitor')::uuid; end if;

  select count(*) into v_n from public.founding_tutors_list where source = 'form' and created_at > now() - interval '1 hour';
  if v_n >= c_cap then
    raise exception 'Many people are joining right now. Please try again in a few minutes.' using errcode = '54000';
  end if;

  insert into public.founding_tutors_list (
    source, full_name, first_name, surname, date_of_birth, code_name, whatsapp, email, email_key, is_adult, subjects, availability, unavailable_weeks, practicum, police_clearance,
    parent_reach, parent_reach_willing, prior_tutoring, heard_from, has_device, has_connection, has_bank,
    consent_contact_at, consent_marketing_at, consent_version, src, status, delete_after)
  values (
    'form', v_name, case when v_new then v_first end, case when v_new then v_surname end, v_dob, v_code, v_wa, v_email, v_email, true, v_subjects, v_avail,
    left(nullif(btrim(coalesce(p ->> 'unavailable_weeks', ''), E' \t\r\n'), ''), 200), v_practicum, v_police,
    v_reach, (p ->> 'parent_reach_willing')::boolean, v_prior, v_heard,
    coalesce(p ->> 'has_device', '') = 'true', coalesce(p ->> 'has_connection', '') = 'true', coalesce(p ->> 'has_bank', '') = 'true',
    now(), case when coalesce(p ->> 'consent_marketing', '') = 'true' then now() else null end,
    left(nullif(btrim(coalesce(p ->> 'consent_version', '')), ''), 40), v_src, 'joined', now() + interval '6 months')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    insert into public.founding_page_events (visitor_id, event, src, first_src) values (coalesce(v_visitor, gen_random_uuid()), 'join', v_src, v_src);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.join_founding_list(jsonb) from public;
grant execute on function public.join_founding_list(jsonb) to anon, authenticated;

-- 4. the sign-up page's call --------------------------------------------------------------------------------------------------------------------
-- Takes the token from the link and returns ONLY what the sign-up form asks for (first name, surname, email, phone, date of birth) or null. No status, no admin note, no other
-- row, no subjects, no src. Callable signed out (a person opening their link has no account yet). First name: the stored one, or for an older row the first word of the full name;
-- surname and date of birth are null for a row made before this change (Odi, Amree and the rows added by hand): the form then leaves those two empty and fills the rest.
create or replace function public.founding_signup_prefill(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_miss_cap constant integer := 60;
  v_tok text := lower(btrim(coalesce(p_token, '')));
  e record;
  v_digits text;
  v_phone text;
begin
  if v_tok !~ '^[0-9a-f]{32}$' then return null; end if;
  -- the circuit breaker (see the top of this file)
  if (select count(*) from public.founding_signup_lookups where created_at > now() - interval '10 minutes') >= c_miss_cap then return null; end if;

  select f.first_name, f.full_name, f.surname, f.email, f.whatsapp, f.date_of_birth into e
  from public.founding_tutors_list f
  where f.signup_token = v_tok
    and f.source in ('form', 'admin')
    and f.user_id is null
    and f.email_key is not null
    and not exists (select 1 from auth.users u where lower(btrim(u.email)) = f.email_key);
  if not found then
    insert into public.founding_signup_lookups default values;
    delete from public.founding_signup_lookups where created_at < now() - interval '1 day';
    return null;
  end if;

  v_digits := regexp_replace(coalesce(e.whatsapp, ''), '[^0-9]', '', 'g');
  v_phone := case when v_digits ~ '^27[0-9]{9}$' then '0' || substr(v_digits, 3) end;
  return jsonb_build_object(
    'first_name', coalesce(nullif(btrim(e.first_name), ''), nullif(split_part(btrim(coalesce(e.full_name, '')), ' ', 1), '')),
    'surname', nullif(btrim(coalesce(e.surname, '')), ''),
    'email', e.email,
    'phone', v_phone,
    'date_of_birth', e.date_of_birth);
end;
$$;
revoke all on function public.founding_signup_prefill(text) from public;
grant execute on function public.founding_signup_prefill(text) to anon, authenticated;

-- 5. the admin app's tokens ---------------------------------------------------------------------------------------------------------------------
-- Every entry's id and token, so the app can put each person's own link into the "place is open" message. Only a verification officer or a super admin.
create or replace function public.admin_founding_signup_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the sign-up links' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'signup_token', f.signup_token))
    from public.founding_tutors_list f
    where f.signup_token is not null and f.source in ('form', 'admin')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_signup_links() from public, anon;
grant execute on function public.admin_founding_signup_links() to authenticated;
