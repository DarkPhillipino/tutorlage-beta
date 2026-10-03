-- 2026-09-30 (second session). Supports the signup/first-sign-in screens for 7k/7l.
--
-- 1. current_policy_versions(): the signup form has to send the Terms/Privacy versions the person
--    ticked, before anyone is signed in — system_settings isn't readable by anon, so this exposes
--    just those three strings.
-- 2. convert_new_account_role(): Google sign-ups always start as a learner (Google's identity data has
--    no room for our role). The old client-side fix-up (queries.ts convertProfileToTutor) could never
--    work — clients have no UPDATE privilege on profiles and no DELETE on student_profiles — so
--    choosing "tutor" before a Google sign-up silently left the person a learner. This does the switch
--    in the database, for tutor or parent, only on an account with no learner activity yet.

create or replace function public.current_policy_versions()
returns table (terms_version text, privacy_version text, guardian_consent_version text)
language sql stable security definer set search_path = public as $$
  select
    (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_terms_version'),
    (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_privacy_version'),
    (select setting_value #>> '{}' from public.system_settings where setting_key = 'guardian_consent_version');
$$;
revoke all on function public.current_policy_versions() from public;
grant execute on function public.current_policy_versions() to anon, authenticated;

create or replace function public.convert_new_account_role(p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_dob date;
  v_email text;
  sp public.student_profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('tutor', 'parent') then
    raise exception 'That account type can''t be chosen' using errcode = '42501';
  end if;

  select role, date_of_birth, email into v_role, v_dob, v_email from public.profiles where id = v_uid;
  if v_role::text = p_role then
    return;  -- already done (e.g. the callback page was reloaded)
  end if;
  if v_role is distinct from 'student' then
    raise exception 'Only a new learner account can change type' using errcode = '42501';
  end if;
  if exists (select 1 from public.parent_student_links where student_id = v_uid)
     or exists (select 1 from public.student_subject_enrollments where student_id = v_uid)
     or exists (select 1 from public.session_requests where student_id = v_uid or requested_by_profile_id = v_uid)
     or exists (select 1 from public.sessions where student_id = v_uid) then
    raise exception 'This account already has learner activity, so its type can''t change' using errcode = '42501';
  end if;
  if v_dob is not null and v_dob > (current_date - interval '18 years')::date then
    raise exception '% accounts on Tutorlage need to be 18 or older', initcap(p_role);
  end if;

  select * into sp from public.student_profiles where id = v_uid;

  update public.profiles set role = p_role::public.user_role where id = v_uid;
  if p_role = 'tutor' then
    insert into public.tutor_profiles (id, headline)
    values (v_uid, concat(coalesce(nullif(sp.first_name, ''), 'Tutor'), ' - Tutor'))
    on conflict (id) do nothing;
  else
    insert into public.parent_profiles (id, first_name, surname, email, phone_number)
    values (v_uid, coalesce(sp.first_name, 'User'), coalesce(sp.surname, ''), coalesce(sp.email, v_email, ''),
            coalesce(sp.phone_number, ''))
    on conflict (id) do nothing;
  end if;
  delete from public.student_profiles where id = v_uid;
end;
$$;
revoke all on function public.convert_new_account_role(text) from public, anon;
grant execute on function public.convert_new_account_role(text) to authenticated;
