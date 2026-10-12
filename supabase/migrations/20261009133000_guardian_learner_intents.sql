-- 2026-10-09 (thirteenth session). Master 7br: a parent's "add a learner" could never succeed.
--
-- server/index.ts (POST /api/guardian/learners) creates the learner with Supabase Auth's admin createUser,
-- putting the guardian in app_metadata (created_by_guardian, relationship, consent_version), and the signup
-- trigger reads it from there. But Auth inserts the auth.users row with only {provider, providers} in
-- app_metadata and writes the caller's app_metadata in a second statement, later in the same transaction
-- (supabase/auth internal/api/admin.go, adminUserCreate: tx.Create(user), then user.UpdateAppMetaData). So
-- this AFTER INSERT trigger never saw a guardian, treated every child as an under-18 self-signup and refused
-- it: "Learners under 18 are added by a parent or guardian from their own Tutorlage account".
-- Shown on dev in a rolled-back run (9 Oct): an insert in Auth's order was refused; the same insert with the
-- guardian already in app_metadata (the order the 7k tests used, which is why they passed) was accepted.
-- Never seen live: no parent has added a learner on dev or production.
--
-- Fix: before createUser the server records the guardian against the learner's id, which it generates and
-- passes to createUser. The trigger looks the id up when app_metadata has no guardian. Only the service role
-- can write the table, and a public sign-up can't choose its own id, so nobody can attach themselves to a
-- parent this way. A row lives at most 10 minutes; the trigger deletes it when it's used, and the server
-- deletes it if createUser fails. The guardian in app_metadata still works (the 7k tests, and in case Auth
-- ever writes it at insert). Only the guardian lines change; everything else is the function as applied by
-- 20260930236000.

create table public.guardian_learner_intents (
  learner_id uuid primary key,
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  relationship public.guardian_relationship not null,
  consent_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

comment on table public.guardian_learner_intents is
  'A parent''s "add a learner" in progress (7br): written by server/ with the service role just before '
  'Auth creates the learner, read and deleted by handle_new_user_role_expansion(). Never readable by clients.';

alter table public.guardian_learner_intents enable row level security;
revoke all on table public.guardian_learner_intents from public, anon, authenticated;
-- Dev grants the service role nothing by default (see 20260930239600), so say what server/ needs: insert the
-- record, delete it (by id, or when expired) if createUser fails. The rolled-back test caught this (G10).
grant select, insert, delete on table public.guardian_learner_intents to service_role;

create or replace function public.handle_new_user_role_expansion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first_name text;
  v_surname text;
  v_full_name text;
  v_phone text;
  v_role_text text;
  v_role public.user_role;
  v_dob date;
  v_guardian uuid;
  v_relationship text;
  v_terms text;
  v_privacy text;
  v_consent_version text;
  v_accepted_by uuid;
  v_intent public.guardian_learner_intents%rowtype;
begin
  v_first_name := nullif(trim(new.raw_user_meta_data->>'first_name'), '');
  v_surname := nullif(trim(new.raw_user_meta_data->>'surname'), '');
  if v_first_name is null then
    v_full_name := regexp_replace(trim(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                                                new.raw_user_meta_data->>'name', '')), '\s+', ' ', 'g');
    if v_full_name <> '' then
      v_first_name := split_part(v_full_name, ' ', 1);
      if v_surname is null and position(' ' in v_full_name) > 0 then
        v_surname := substr(v_full_name, position(' ' in v_full_name) + 1);
      end if;
    end if;
  end if;
  v_first_name := coalesce(v_first_name, 'User');
  v_surname := coalesce(v_surname, '');
  v_phone := coalesce(new.phone, new.raw_user_meta_data->>'phone_number', '');

  v_role_text := coalesce(new.raw_user_meta_data->>'role', 'student');
  if v_role_text not in ('student', 'tutor', 'parent') then
    v_role_text := 'student';
  end if;
  v_role := v_role_text::public.user_role;

  begin
    v_dob := nullif(new.raw_user_meta_data->>'date_of_birth', '')::date;
  exception when others then
    v_dob := null;
  end;
  if not public.is_plausible_date_of_birth(v_dob) then
    v_dob := null;
  end if;

  begin
    v_guardian := nullif(new.raw_app_meta_data->>'created_by_guardian', '')::uuid;
  exception when others then
    v_guardian := null;
  end;

  -- 7br: Auth writes app_metadata after this insert, so look for the guardian the server recorded against
  -- this learner's id. Used once, and only while it's fresh.
  if v_guardian is null then
    select * into v_intent
    from public.guardian_learner_intents
    where learner_id = new.id and expires_at > now();
    if found then
      v_guardian := v_intent.guardian_id;
      delete from public.guardian_learner_intents where learner_id = new.id;
    end if;
  end if;

  if v_role in ('tutor', 'parent') and v_dob is not null and v_dob > (current_date - interval '18 years')::date then
    raise exception '% accounts on Tutorlage need to be 18 or older', initcap(v_role_text);
  end if;
  if v_role = 'student' and v_dob is not null and v_dob > (current_date - interval '18 years')::date
     and v_guardian is null then
    raise exception 'Learners under 18 are added by a parent or guardian from their own Tutorlage account';
  end if;
  if v_guardian is not null then
    if v_role <> 'student' then
      raise exception 'Only learner accounts can be created by a guardian';
    end if;
    if not exists (select 1 from public.profiles where id = v_guardian and role = 'parent')
       or not public.is_adult(v_guardian) then
      raise exception 'The guardian for this learner account must be a parent account with a date of birth showing 18 or older';
    end if;
    v_relationship := coalesce(nullif(new.raw_app_meta_data->>'relationship', ''),
                               v_intent.relationship::text, 'guardian');
    if v_relationship not in ('mother', 'father', 'guardian') then
      raise exception 'Only a parent or legal guardian can add a learner';
    end if;
  end if;

  insert into public.profiles (id, full_name, email, role, date_of_birth)
  values (new.id, trim(concat(v_first_name, ' ', v_surname)), new.email, v_role, v_dob)
  on conflict (id) do nothing;

  if v_role = 'student' then
    insert into public.student_profiles (id, first_name, surname, email, phone_number, grade_level, school_id)
    values (new.id, v_first_name, v_surname, new.email, v_phone,
            nullif(new.raw_user_meta_data->>'grade_level', ''),
            case when coalesce(new.raw_user_meta_data->>'school_id', '') ~ '^[0-9a-f-]{36}$'
                 then (new.raw_user_meta_data->>'school_id')::uuid end)
    on conflict (id) do nothing;
  elsif v_role = 'parent' then
    insert into public.parent_profiles (id, first_name, surname, email, phone_number)
    values (new.id, v_first_name, v_surname, new.email, v_phone)
    on conflict (id) do nothing;
  elsif v_role = 'tutor' then
    insert into public.tutor_profiles (id, headline)
    values (new.id, concat(v_first_name, ' - Tutor'))
    on conflict (id) do nothing;
  end if;

  if v_guardian is not null then
    insert into public.parent_student_links (parent_id, student_id, relationship, can_book_sessions)
    values (v_guardian, new.id, v_relationship::public.guardian_relationship, true);
    v_consent_version := coalesce(nullif(new.raw_app_meta_data->>'consent_version', ''),
      v_intent.consent_version,
      (select setting_value #>> '{}' from public.system_settings where setting_key = 'guardian_consent_version'));
    insert into public.guardian_consents (guardian_profile_id, learner_profile_id, consent_text_version)
    values (v_guardian, new.id, v_consent_version);
  end if;

  v_terms := new.raw_user_meta_data->>'accepted_terms_version';
  v_privacy := new.raw_user_meta_data->>'accepted_privacy_version';
  v_accepted_by := coalesce(v_guardian, new.id);
  if v_terms is not null and v_terms = (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_terms_version') then
    insert into public.policy_acceptances (profile_id, accepted_by_profile_id, document, version, method)
    values (new.id, v_accepted_by, 'terms', v_terms,
            case when v_guardian is null then 'signup_checkbox' else 'guardian_added_learner' end);
  end if;
  if v_privacy is not null and v_privacy = (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_privacy_version') then
    insert into public.policy_acceptances (profile_id, accepted_by_profile_id, document, version, method)
    values (new.id, v_accepted_by, 'privacy', v_privacy,
            case when v_guardian is null then 'signup_checkbox' else 'guardian_added_learner' end);
  end if;

  return new;
end;
$function$;

revoke execute on function public.handle_new_user_role_expansion() from public, anon, authenticated;
