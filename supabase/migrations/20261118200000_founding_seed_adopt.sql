-- 18 Nov 2026 (PM request, first PM chat): "adopt" mode for the CEO's account tool. Odi's account was made through the ordinary sign-up form, not the tool: the account exists, the list row is linked to it,
-- but the email is unconfirmed, the person has never signed in, no subject claims were filed and the list row still says "joined". The tool's normal mode refuses ("already has an account").
-- Purely ADDITIVE: ONE new function, SERVICE KEY ONLY (the CEO's tool). Nothing that exists is changed; it does nothing until the tool calls it with the secret key.
--
-- founding_seed_adopt(p_key, p_dry default true): p_key is the list tag (ceo-odi) or the email, as for founding_seed_row. It finds the list row, takes the account from the row's OWN link (user_id; never from
-- anything typed), and checks that adopting is safe. The checks (every one must hold, else it lists the problems and, when not a dry run, raises and changes nothing):
--   - the row has a linked account, that account exists in Auth with the same email as the row, and has a tutor profile;
--   - the person has NEVER signed in (auth.users.last_sign_in_at is null);
--   - the account has NO subject claims yet.
-- p_dry = true (the default) writes nothing and answers with what it found. p_dry = false: runs founding_seed_finish (the existing filing function: files the row's subjects as UNVERIFIED claims, links the row,
-- moves it to "signed_up", released now, wave 1 if none, no delete date), and corrects the capitalisation of the name on the account ONLY when the list row holds a first name and surname (or exactly two
-- words typed as the full name) that are the SAME words as the account's name apart from capitals; otherwise the name is left and name_note says why. It writes nothing about consent, date of birth,
-- documents, hours or verification, and never touches any other account. The password and the confirmed email are set by the tool through Supabase Auth's admin API (no mail is sent), not here.
-- Rollback: Drake/programmer/rollbacks/20261118200000_founding_seed_adopt_ROLLBACK.sql
create or replace function public.founding_seed_adopt(p_key text, p_dry boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_key, '')));
  n integer;
  r public.founding_tutors_list%rowtype;
  v_email text;
  v_last_sign_in timestamptz;
  v_confirmed timestamptz;
  v_profile_name text;
  v_claims integer := 0;
  v_row_name text;
  v_name_fix text := null;
  v_name_note text := null;
  v_problems text[] := '{}';
  v_fin jsonb := null;
  words text[];
  norm text := '\s+';
begin
  if k = '' then raise exception 'Name the list tag or the email' using errcode = '22023'; end if;
  select count(*) into n from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
  if n = 0 then raise exception 'No list row has the tag or email "%"', k using errcode = 'P0002'; end if;
  if n > 1 then raise exception 'More than one list row matches "%". Use the person''s email address instead.', k using errcode = '22023'; end if;
  select * into r from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k) for update;

  if r.user_id is null then
    v_problems := v_problems || 'No account is linked to this list row. Use the normal mode (it makes the account).'::text;
  else
    select lower(btrim(u.email)), u.last_sign_in_at, u.email_confirmed_at into v_email, v_last_sign_in, v_confirmed from auth.users u where u.id = r.user_id;
    if v_email is null then
      v_problems := v_problems || 'The account linked to this row is not in Auth.'::text;
    elsif r.email_key is null or v_email <> r.email_key then
      v_problems := v_problems || 'The account linked to this row has a different email address from the row.'::text;
    end if;
    if v_last_sign_in is not null then
      v_problems := v_problems || 'This person has already signed in, so their account is theirs now: nothing is changed.'::text;
    end if;
    if not exists (select 1 from public.tutor_profiles t where t.id = r.user_id) then
      v_problems := v_problems || 'The account has no tutor profile.'::text;
    end if;
    select count(*) into v_claims from public.tutor_subject_competencies c where c.tutor_id = r.user_id;
    if v_claims > 0 then
      v_problems := v_problems || format('The account already has %s subject claim(s), so it was already filed.', v_claims)::text;
    end if;
    select p.full_name into v_profile_name from public.profiles p where p.id = r.user_id;
    -- the capitalisation fix: only when the row's name is clearly the same words
    if coalesce(btrim(r.first_name), '') <> '' and coalesce(btrim(r.surname), '') <> '' then
      v_row_name := btrim(r.first_name) || ' ' || btrim(r.surname);
    else
      words := regexp_split_to_array(btrim(coalesce(r.full_name, '')), norm);
      if array_length(words, 1) = 2 and words[1] <> '' then v_row_name := words[1] || ' ' || words[2]; end if;
    end if;
    if v_row_name is null then
      v_name_note := 'The list row has no surname, so the name on the account ("' || coalesce(v_profile_name, '') || '") is left as typed.';
    elsif lower(regexp_replace(btrim(coalesce(v_profile_name, '')), norm, ' ', 'g')) = lower(regexp_replace(v_row_name, norm, ' ', 'g')) then
      if btrim(v_profile_name) <> v_row_name then v_name_fix := v_row_name; end if;
    else
      v_name_note := 'The name on the account ("' || coalesce(v_profile_name, '') || '") and on the list row ("' || v_row_name || '") are not the same words, so the name is left as typed.';
    end if;
  end if;

  if not coalesce(p_dry, true) then
    if array_length(v_problems, 1) is not null then
      raise exception 'Not adopted: %', v_problems[1] using errcode = '22023';
    end if;
    v_fin := public.founding_seed_finish(r.id, r.user_id);
    if v_name_fix is not null then
      update public.profiles set full_name = v_name_fix where id = r.user_id;
    end if;
  end if;

  return jsonb_build_object(
    'dry', coalesce(p_dry, true),
    'ok', array_length(v_problems, 1) is null,
    'problems', to_jsonb(v_problems),
    'row_id', r.id,
    'src', r.src,
    'user_id', r.user_id,
    'email', r.email,
    'list_status', r.status,
    'email_confirmed', v_confirmed is not null,
    'never_signed_in', v_last_sign_in is null,
    'claims_now', v_claims,
    'row_subjects', jsonb_array_length(r.subjects),
    'profile_name', v_profile_name,
    'name_fix', v_name_fix,
    'name_note', v_name_note,
    'filed', v_fin
  );
end;
$$;
revoke all on function public.founding_seed_adopt(text, boolean) from public, anon, authenticated;
grant execute on function public.founding_seed_adopt(text, boolean) to service_role;
