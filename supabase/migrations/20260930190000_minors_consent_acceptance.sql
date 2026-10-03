-- 2026-09-30. Backlog 7k/7l, built to legal's spec (Drake/legal/specs/7k-minors-consent-and-acceptance.md)
-- plus two security holes found while building it.
--
-- SECURITY 1 (critical): handle_new_user_role_expansion() trusted the `role` in signup metadata —
-- which any caller of the public signUp API controls — and created an admin_profiles row for
-- role = 'admin'. admin_profiles.is_active defaults to true, so anyone could have become an active
-- admin. Only email confirmation being broken (7j) was stopping it. Signup can now only ever create
-- student, tutor or parent accounts.
-- SECURITY 2: "Parents can manage student links" let any user insert a link to any student (no role
-- or consent check), which then granted read access to that student's profile, enrolments and
-- sessions. Links are now created only by the guardian flow below.
--
-- Revised before first apply (2026-09-30, second session), after checking it against the live dev
-- database:
-- * profiles is readable by everyone (a table-wide SELECT grant plus a `true` policy), so a new
--   date_of_birth column would have been public. The table-wide grant is replaced with a column list
--   that leaves date_of_birth out; dates of birth are read and written only through the functions
--   below. (Email and phone are still public — tracked separately as backlog 7o.)
-- * A missing date of birth used to count as "adult". It now counts as "unknown": booking for
--   yourself needs a recorded date of birth showing 18+, and so does being a guardian.
-- * Clients have no UPDATE privilege on profiles at all, so a date of birth is set through
--   set_my_date_of_birth() (once) or admin_set_date_of_birth().
-- * The is_minor / consent helpers aren't callable by clients (any user could have asked "is this
--   profile a minor?" about every profile id). Policies go through can_book_for() /
--   can_act_for_learner(), which only answer for the caller.
-- * A guardian must be a mother, father or legal guardian (POPIA's "competent person").
-- * A session request's enrolment must belong to the learner the request is for.

alter table public.profiles add column if not exists date_of_birth date;

revoke select on public.profiles from anon, authenticated;
grant select (id, role, full_name, email, phone_number, avatar_url, created_at, updated_at)
  on public.profiles to anon, authenticated;

-- Age helpers (internal: used by policies through the caller-scoped wrappers below) ---------------------
create or replace function public.is_plausible_date_of_birth(p_dob date)
returns boolean language sql stable set search_path = public as $$
  select p_dob is not null and p_dob > date '1900-01-01' and p_dob <= current_date;
$$;

create or replace function public.is_minor(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth > (current_date - interval '18 years')::date
                   from public.profiles where id = p_profile_id), false);
$$;
revoke all on function public.is_minor(uuid) from public, anon, authenticated;

-- True only when a date of birth is on file and shows 18+. Unknown is not adult.
create or replace function public.is_adult(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth <= (current_date - interval '18 years')::date
                   from public.profiles where id = p_profile_id), false);
$$;
revoke all on function public.is_adult(uuid) from public, anon, authenticated;

-- Current document versions (what "accepted" means) -------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('current_terms_version', '"2026-10-01-draft"'::jsonb, 'Version of the Terms of Service users must accept.'),
  ('current_privacy_version', '"2026-10-01-draft"'::jsonb, 'Version of the Privacy Policy users must accept.'),
  ('guardian_consent_version', '"2026-10-01-draft"'::jsonb, 'Version of the POPIA s35 guardian consent text.')
on conflict (setting_key) do nothing;

-- Acceptance records (ECTA): append-only, server time --------------------------------------------------
create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  accepted_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  method text not null check (method in ('signup_checkbox', 'reaccept_prompt', 'guardian_added_learner'))
);
create index if not exists policy_acceptances_profile_idx on public.policy_acceptances (profile_id, document);
alter table public.policy_acceptances enable row level security;
drop policy if exists "Users view own acceptances" on public.policy_acceptances;
create policy "Users view own acceptances" on public.policy_acceptances for select
  using (auth.uid() = profile_id or auth.uid() = accepted_by_profile_id or public.is_active_admin());
revoke all on public.policy_acceptances from anon, authenticated;
grant select on public.policy_acceptances to authenticated;
-- No client insert/update/delete: acceptance is recorded by the functions below.

-- Guardian consent (POPIA s34/s35) --------------------------------------------------------------------
create table if not exists public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  guardian_profile_id uuid not null references public.profiles(id) on delete cascade,
  learner_profile_id uuid not null references public.profiles(id) on delete cascade,
  consent_text_version text not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index if not exists guardian_consents_pair_idx on public.guardian_consents (guardian_profile_id, learner_profile_id);
alter table public.guardian_consents enable row level security;
drop policy if exists "Guardians and learners view consents" on public.guardian_consents;
create policy "Guardians and learners view consents" on public.guardian_consents for select
  using (auth.uid() = guardian_profile_id or auth.uid() = learner_profile_id or public.is_active_admin());
revoke all on public.guardian_consents from anon, authenticated;
grant select on public.guardian_consents to authenticated;

create or replace function public.has_active_guardian_consent(p_guardian uuid, p_learner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_consents c
    join public.parent_student_links l on l.parent_id = c.guardian_profile_id and l.student_id = c.learner_profile_id
    where c.guardian_profile_id = p_guardian and c.learner_profile_id = p_learner
      and c.withdrawn_at is null and l.can_book_sessions
  );
$$;
revoke all on function public.has_active_guardian_consent(uuid, uuid) from public, anon, authenticated;

-- Caller-scoped wrappers for policies: they only ever answer about the signed-in user.
create or replace function public.can_act_for_learner(p_learner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.is_adult(auth.uid())
     and public.has_active_guardian_consent(auth.uid(), p_learner);
$$;
revoke all on function public.can_act_for_learner(uuid) from public, anon;
grant execute on function public.can_act_for_learner(uuid) to authenticated;

create or replace function public.can_book_for(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    (auth.uid() = p_student and public.is_adult(p_student))
    or public.can_act_for_learner(p_student)
  );
$$;
revoke all on function public.can_book_for(uuid) from public, anon;
grant execute on function public.can_book_for(uuid) to authenticated;

-- SECURITY 2: links only via the guardian flow -----------------------------------------------------------
drop policy if exists "Parents can manage student links" on public.parent_student_links;
drop policy if exists "Parents view own links" on public.parent_student_links;
create policy "Parents view own links" on public.parent_student_links for select using (auth.uid() = parent_id);
drop policy if exists "Admins manage student links" on public.parent_student_links;
create policy "Admins manage student links" on public.parent_student_links
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- Signup (SECURITY 1 + ages + acceptance + guardian-created learners) --------------------------------------
create or replace function public.handle_new_user_role_expansion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first_name text;
  v_surname text;
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
begin
  v_first_name := coalesce(nullif(trim(new.raw_user_meta_data->>'first_name'), ''), 'User');
  v_surname := coalesce(new.raw_user_meta_data->>'surname', '');
  v_phone := coalesce(new.phone, new.raw_user_meta_data->>'phone_number', '');

  -- user_metadata is set by whoever calls signUp — never trust it for privileges.
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
    v_dob := null;  -- unknown, which never counts as adult
  end if;

  -- app_metadata can only be set with the service-role key (server/): it marks a learner account
  -- a guardian created through Tutorlage.
  begin
    v_guardian := nullif(new.raw_app_meta_data->>'created_by_guardian', '')::uuid;
  exception when others then
    v_guardian := null;
  end;

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
    v_relationship := coalesce(nullif(new.raw_app_meta_data->>'relationship', ''), 'guardian');
    if v_relationship not in ('mother', 'father', 'guardian') then
      raise exception 'Only a parent or legal guardian can add a learner';
    end if;
  end if;

  insert into public.profiles (id, full_name, email, role, date_of_birth)
  values (new.id, concat(v_first_name, ' ', v_surname), new.email, v_role, v_dob)
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
      (select setting_value #>> '{}' from public.system_settings where setting_key = 'guardian_consent_version'));
    insert into public.guardian_consents (guardian_profile_id, learner_profile_id, consent_text_version)
    values (v_guardian, new.id, v_consent_version);
  end if;

  -- Acceptance ticked at signup (or by the guardian for a learner) — recorded only when it's for the
  -- current versions; otherwise the app asks again on first sign-in.
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
$$;

-- Dates of birth: read and set only through these ------------------------------------------------------
create or replace function public.my_date_of_birth()
returns date language sql stable security definer set search_path = public as $$
  select date_of_birth from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_date_of_birth() from public, anon;
grant execute on function public.my_date_of_birth() to authenticated;

-- Once only (Google sign-ups and accounts created before this change). Correcting it takes an admin.
create or replace function public.set_my_date_of_birth(p_dob date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
  v_current date;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.is_plausible_date_of_birth(p_dob) then
    raise exception 'Enter a real date of birth';
  end if;
  select role, date_of_birth into v_role, v_current from public.profiles where id = auth.uid();
  if v_current is not null then
    raise exception 'Contact support to correct your date of birth' using errcode = '42501';
  end if;
  if v_role in ('tutor', 'parent') and p_dob > (current_date - interval '18 years')::date then
    raise exception '% accounts on Tutorlage need to be 18 or older', initcap(v_role::text);
  end if;
  update public.profiles set date_of_birth = p_dob where id = auth.uid();
end;
$$;
revoke all on function public.set_my_date_of_birth(date) from public, anon;
grant execute on function public.set_my_date_of_birth(date) to authenticated;

-- Admins record a date of birth from the ID document (needed before verifying a tutor, 7l).
create or replace function public.admin_set_date_of_birth(p_profile uuid, p_dob date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.is_plausible_date_of_birth(p_dob) then
    raise exception 'Enter a real date of birth';
  end if;
  update public.profiles set date_of_birth = p_dob where id = p_profile;
  if not found then
    raise exception 'No such profile';
  end if;
end;
$$;
revoke all on function public.admin_set_date_of_birth(uuid, date) from public, anon;
grant execute on function public.admin_set_date_of_birth(uuid, date) to authenticated;

create or replace function public.admin_profile_private(p_ids uuid[])
returns table (id uuid, email text, phone_number text, date_of_birth date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query select p.id, p.email, p.phone_number, p.date_of_birth from public.profiles p where p.id = any(p_ids);
end;
$$;
revoke all on function public.admin_profile_private(uuid[]) from public, anon;
grant execute on function public.admin_profile_private(uuid[]) to authenticated;

-- Documents the signed-in user still has to accept, and accepting them (Google sign-ups, older
-- accounts, and anyone after a version change).
create or replace function public.my_pending_acceptances()
returns table (document text, version text)
language sql stable security definer set search_path = public as $$
  select d.document, d.version
  from (values
    ('terms', (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_terms_version')),
    ('privacy', (select setting_value #>> '{}' from public.system_settings where setting_key = 'current_privacy_version'))
  ) as d(document, version)
  where auth.uid() is not null
    and d.version is not null
    and not exists (select 1 from public.policy_acceptances a
                    where a.profile_id = auth.uid() and a.document = d.document and a.version = d.version);
$$;
revoke all on function public.my_pending_acceptances() from public, anon;
grant execute on function public.my_pending_acceptances() to authenticated;

create or replace function public.accept_current_policies()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.policy_acceptances (profile_id, accepted_by_profile_id, document, version, method)
  select auth.uid(), auth.uid(), p.document, p.version, 'reaccept_prompt' from public.my_pending_acceptances() p;
end;
$$;
revoke all on function public.accept_current_policies() from public, anon;
grant execute on function public.accept_current_policies() to authenticated;

-- A guardian can withdraw consent at any time; it stops new bookings immediately.
create or replace function public.withdraw_guardian_consent(p_learner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.guardian_consents set withdrawn_at = now()
  where guardian_profile_id = auth.uid() and learner_profile_id = p_learner and withdrawn_at is null;
  if not found then
    raise exception 'No active consent to withdraw for that learner' using errcode = '42501';
  end if;
  update public.parent_student_links set can_book_sessions = false
  where parent_id = auth.uid() and student_id = p_learner;
end;
$$;
revoke all on function public.withdraw_guardian_consent(uuid) from public, anon;
grant execute on function public.withdraw_guardian_consent(uuid) to authenticated;

-- Who can book for whom --------------------------------------------------------------------------------
-- An adult learner (date of birth on file, 18+) books for themselves; a learner under 18 has a
-- view-only account (CEO, 2026-09-30) and is booked for by an adult guardian with active consent.
drop policy if exists "Students create own session requests" on public.session_requests;
drop policy if exists "Learners or their guardians create session requests" on public.session_requests;
create policy "Learners or their guardians create session requests" on public.session_requests
  for insert with check (auth.uid() = requested_by_profile_id and public.can_book_for(student_id));

drop policy if exists "Guardians create enrollments for linked learners" on public.student_subject_enrollments;
create policy "Guardians create enrollments for linked learners" on public.student_subject_enrollments
  for insert with check (public.can_act_for_learner(student_id));

-- Same checks as before, plus: the enrolment must belong to the learner the request is for.
create or replace function public.guard_session_request_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  v_price numeric;
  v_currency text;
  v_tier integer;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.tutor_id := null;
  new.status := 'pending';
  new.payment_status := 'initiated';
  new.resulting_session_id := null;
  new.refund_request_id := null;
  new.responded_at := null;

  if new.duration_hours is null or new.duration_hours <= 0 or new.duration_hours > 8 then
    raise exception 'A session has to be between a few minutes and 8 hours long';
  end if;
  if new.paystack_reference is null or new.paystack_reference !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception 'A valid payment reference is required';
  end if;
  if new.enrollment_id is not null and not exists (
    select 1 from public.student_subject_enrollments e
    where e.id = new.enrollment_id and e.student_id = new.student_id
  ) then
    raise exception 'That subject enrolment isn''t for this learner';
  end if;

  if new.min_sub_tier_id is not null then
    select s.max_allowed_rate, s.tier_id, t.currency_code into v_price, v_tier, v_currency
    from public.sub_tier_definitions s join public.tier_definitions t on t.id = s.tier_id
    where s.id = new.min_sub_tier_id;
    if v_price is null then
      raise exception 'Unknown price level';
    end if;
    new.tier_id := v_tier;
  elsif new.tier_id is not null then
    select min_rate, currency_code into v_price, v_currency from public.tier_definitions where id = new.tier_id;
    if v_price is null then
      raise exception 'Unknown pricing level';
    end if;
  else
    raise exception 'Choose a price level before sending a request';
  end if;

  new.charged_amount := round(v_price * new.duration_hours, 2);
  new.currency_code := trim(v_currency);
  return new;
end;
$$;

-- 7l: a tutor can only be verified once their date of birth shows they're 18+ ---------------------------
-- security definer: the admin verifying runs as `authenticated`, which can't read date_of_birth.
create or replace function public.enforce_tutor_age_on_verify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dob date;
begin
  if new.is_verified and not coalesce(old.is_verified, false) then
    select date_of_birth into v_dob from public.profiles where id = new.id;
    if v_dob is null then
      raise exception 'Record the tutor''s date of birth (from their ID) before verifying them';
    end if;
    if v_dob > (current_date - interval '18 years')::date then
      raise exception 'Tutors must be 18 or older';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_tutor_age_on_verify on public.tutor_profiles;
create trigger enforce_tutor_age_on_verify
  before update of is_verified on public.tutor_profiles
  for each row execute function public.enforce_tutor_age_on_verify();

-- Profiles guard: a user may set their own date of birth once; changing it takes an admin.
-- (Clients have no UPDATE privilege on profiles today; this is defence in depth if one is granted.)
create or replace function public.guard_profiles()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role not in ('student', 'tutor', 'parent') then
    raise exception 'That account type can''t be self-assigned' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'Profile id can''t change' using errcode = '42501';
    end if;
    if new.role is distinct from old.role and not (old.role = 'student' and new.role = 'tutor') then
      raise exception 'That account type change isn''t allowed' using errcode = '42501';
    end if;
    if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'Contact support to correct your date of birth' using errcode = '42501';
    end if;
    if new.role = 'tutor' and new.date_of_birth is not null
       and new.date_of_birth > (current_date - interval '18 years')::date then
      raise exception 'Tutors on Tutorlage need to be 18 or older';
    end if;
  end if;
  return new;
end;
$$;
