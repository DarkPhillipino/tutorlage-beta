-- SEEDING THE WARM TUTORS' ACCOUNTS (CEO's order of 17 Nov 2026; the PM line "SEED THE TWO WARM TUTORS' ACCOUNTS" and its CORRECTION at the end of Drake/programmer/pm-instructions.md).
-- Odi and Amree are on the founding list and "would have signed up directly anyway", so the CEO makes their accounts from their list rows with a small tool he runs
-- (Drake/programmer/tools/create-warm-tutor-account.mjs). The tool creates the account through Supabase Auth's admin API (the same path the real sign-up uses, so the on_auth_user_created
-- trigger builds the profile, the tutor profile and links the list row), with the email marked confirmed and the password the CEO types; it sends no mail. This migration is the database
-- half, and the surname prompt the app needs for a person whose list row holds no surname.
--
-- WHAT THIS MIGRATION ADDS (additive; nothing that exists is dropped or changed; no data changes):
--   NEW  function founding_seed_row(text)             SERVICE KEY ONLY (the CEO's tool). Given a list tag (for example ceo-odi) or an email, returns what the row holds that an account needs:
--                                                     the first name, surname and date of birth where the row has them, email, WhatsApp number, subjects, availability, practicum, police clearance,
--                                                     whether the person already has an account. The list table itself still has no right for any API role.
--   NEW  function founding_seed_finish(uuid, uuid)    SERVICE KEY ONLY. After the account exists: checks the account really is the one for that row (same email, a tutor profile),
--                                                     links the row to it, moves the row to "signed up" (released now, wave 1 if it had none, no delete date while an account exists), and files the row's
--                                                     subjects with their grade ranges as UNVERIFIED claims (verification_status 'pending'), so the normal admin review still decides. Safe to run twice.
--                                                     It writes nothing about consent, date of birth, documents, hours or verification.
--   NEW  function my_needs_surname()                  signed-in person: true only for a TUTOR whose saved name is one word (no surname).
--   NEW  function set_my_surname(text)                signed-in person: saves the surname, only while the saved name is one word, only for a tutor, only their own. Not a way to rename anyone.
-- NOT TOUCHED: the sign-up trigger, any other function, any table definition, any policy, the founding gate, the list's other functions.
-- Date of birth and the Terms and Privacy acceptance already have their prompt (AccountGate: set_my_date_of_birth, accept_current_policies); the new surname prompt sits beside them.

-- 1. the list row, for the tool ---------------------------------------------------------------------------------------------------------------------
create or replace function public.founding_seed_row(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_key, '')));
  n integer;
  r public.founding_tutors_list%rowtype;
begin
  if k = '' then return null; end if;
  select count(*) into n from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
  if n = 0 then return null; end if;
  if n > 1 then
    raise exception 'More than one list row matches "%". Use the person''s email address instead.', k using errcode = '22023';
  end if;
  select * into r from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
  return jsonb_build_object(
    'id', r.id,
    'src', r.src,
    'status', r.status,
    'full_name', r.full_name,
    'first_name', coalesce(nullif(btrim(coalesce(r.first_name, '')), ''), nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), '')),
    'surname', nullif(btrim(coalesce(r.surname, '')), ''),
    'date_of_birth', r.date_of_birth,
    'email', r.email,
    'whatsapp', r.whatsapp,
    'subjects', r.subjects,
    'availability', to_jsonb(r.availability),
    'practicum', r.practicum,
    'police_clearance', r.police_clearance,
    'has_account', (r.user_id is not null or exists (select 1 from auth.users u where lower(btrim(u.email)) = r.email_key))
  );
end;
$$;
revoke all on function public.founding_seed_row(text) from public, anon, authenticated;
grant execute on function public.founding_seed_row(text) to service_role;

-- 2. after the account exists --------------------------------------------------------------------------------------------------------------------------
create or replace function public.founding_seed_finish(p_row_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.founding_tutors_list%rowtype;
  v_email text;
  el jsonb;
  n integer;
  v_added integer := 0;
  v_skipped integer := 0;
begin
  select * into r from public.founding_tutors_list where id = p_row_id for update;
  if not found or r.source not in ('form', 'admin') then
    raise exception 'There is no such list row' using errcode = 'P0002';
  end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or r.email_key is null or v_email <> r.email_key then
    raise exception 'That account is not the one for this list row (the email addresses differ)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tutor_profiles t where t.id = p_user_id) then
    raise exception 'That account has no tutor profile' using errcode = '22023';
  end if;
  if r.user_id is not null and r.user_id <> p_user_id then
    raise exception 'This list row is already linked to a different account' using errcode = '23505';
  end if;
  if exists (select 1 from public.founding_tutors_list g where g.user_id = p_user_id and g.id <> r.id) then
    raise exception 'That account is already linked to a different list row' using errcode = '23505';
  end if;

  -- the subjects the person gave, as unverified claims (one range per subject is all the table allows: a second range for the same subject is skipped and counted)
  for el in select value from jsonb_array_elements(r.subjects) loop
    insert into public.tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (p_user_id, el ->> 'subject', el ->> 'min_grade', el ->> 'max_grade', 'pending')
    on conflict (tutor_id, subject_name, curriculum) do nothing;
    get diagnostics n = row_count;
    if n = 1 then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  update public.founding_tutors_list
     set user_id = p_user_id,
         status = case when status = 'verified' then status else 'signed_up' end,
         released_at = coalesce(released_at, now()),
         wave = coalesce(wave, 1),
         delete_after = null,
         lapsed_at = null
   where id = r.id;
  return jsonb_build_object('ok', true, 'competencies_added', v_added, 'competencies_skipped', v_skipped);
end;
$$;
revoke all on function public.founding_seed_finish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.founding_seed_finish(uuid, uuid) to service_role;

-- 3. the surname prompt --------------------------------------------------------------------------------------------------------------------------------
create or replace function public.my_needs_surname()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role = 'tutor' and position(' ' in btrim(p.full_name)) = 0 from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.my_needs_surname() from public, anon;
grant execute on function public.my_needs_surname() to authenticated;

create or replace function public.set_my_surname(p_surname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_surname, ''), E' \t\r\n');
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if char_length(v) < 1 or char_length(v) > 50 or v ~ '[<>[:cntrl:]]' then
    raise exception 'Enter your surname' using errcode = '22023';
  end if;
  select btrim(p.full_name) into v_name from public.profiles p where p.id = auth.uid() and p.role = 'tutor';
  if v_name is null or position(' ' in v_name) > 0 then
    raise exception 'Your surname is already saved. Contact support to change it' using errcode = '42501';
  end if;
  update public.profiles set full_name = v_name || ' ' || v where id = auth.uid();
end;
$$;
revoke all on function public.set_my_surname(text) from public, anon;
grant execute on function public.set_my_surname(text) to authenticated;
