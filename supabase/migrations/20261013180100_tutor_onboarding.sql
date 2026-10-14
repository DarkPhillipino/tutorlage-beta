-- Master 7cx: the tutor's second and third sign-up pages. Needs 20261013180000 (the new document type) first.
--
-- WHAT THIS DOES
--  1. tutor_onboarding: one row per tutor saying which kind of tutor they are ('beginner' or 'experienced'), when
--     they agreed to Tutorlage keeping their documents, and which wording they agreed to. Tutors can READ their own
--     row; they cannot write it directly. Two functions write it (set_my_tutor_track, record_my_documents_consent),
--     so the consent time is the database's clock, never the browser's.
--  2. Every tutor that exists TODAY gets a row marked grandfathered, so the test phase 1 tutors are not asked for
--     documents. Tutors who sign up after this migration have no row until they pick a kind, so the app asks them.
--  3. tutor_verification_documents.issued_on: the date on a police clearance certificate (the app only accepts one
--     issued in the last 6 months; the review team sees the date and when it runs out).
--  4. A tutor can no longer change or delete a document once Tutorlage has verified it. This is what keeps the ID
--     copy on file: a verified ID, police clearance or results file can't be erased or swapped by the tutor, who
--     adds a NEW document instead (for example a fresh police clearance every 6 months; the old one stays on file).
--     This REPLACES two existing policies:
--        - on tutor_verification_documents: "Tutors manage own documents" (ALL, role public) becomes four
--          policies: read, add, change-unless-verified, delete-unless-verified;
--        - on storage.objects: "Tutors delete own documents" now also refuses files that a verified document uses.
--     No function and no trigger is replaced (guard_verification_documents is untouched).

-- ---- 1. who is what kind of tutor, and who agreed ---------------------------------------------------------------
create table if not exists public.tutor_onboarding (
  tutor_id uuid primary key references public.tutor_profiles (id) on delete cascade,
  track text check (track in ('beginner', 'experienced')),
  grandfathered boolean not null default false,
  consent_version text,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tutor_onboarding enable row level security;

drop policy if exists "Tutors read own onboarding" on public.tutor_onboarding;
create policy "Tutors read own onboarding" on public.tutor_onboarding
  for select to authenticated using (auth.uid() = tutor_id);

drop policy if exists "Admins read all onboarding" on public.tutor_onboarding;
create policy "Admins read all onboarding" on public.tutor_onboarding
  for select to authenticated using (public.is_active_admin());

-- Reads only for signed-in people; every write goes through the two functions below.
revoke all on public.tutor_onboarding from anon, authenticated;
grant select on public.tutor_onboarding to authenticated;

create or replace function public.set_my_tutor_track(p_track text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_track is null or p_track not in ('beginner', 'experienced') then
    raise exception 'Choose beginner or experienced' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = auth.uid()) then
    raise exception 'Only tutor accounts can choose a tutor type' using errcode = '42501';
  end if;
  insert into public.tutor_onboarding (tutor_id, track)
  values (auth.uid(), p_track)
  on conflict (tutor_id) do update set track = excluded.track, updated_at = now();
end;
$$;

create or replace function public.record_my_documents_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_version is null or length(trim(p_version)) = 0 or length(p_version) > 100 then
    raise exception 'A consent version is required' using errcode = '22023';
  end if;
  update public.tutor_onboarding
     set consent_version = p_version, consented_at = now(), updated_at = now()
   where tutor_id = auth.uid() and track is not null;
  if not found then
    raise exception 'Choose your tutor type first' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.set_my_tutor_track(text) from public, anon;
revoke all on function public.record_my_documents_consent(text) from public, anon;
grant execute on function public.set_my_tutor_track(text) to authenticated;
grant execute on function public.record_my_documents_consent(text) to authenticated;

-- ---- 2. the tutors who exist today are not asked ----------------------------------------------------------------
insert into public.tutor_onboarding (tutor_id, grandfathered)
select id, true from public.tutor_profiles
on conflict (tutor_id) do nothing;

-- ---- 3. the date on a police clearance certificate --------------------------------------------------------------
alter table public.tutor_verification_documents add column if not exists issued_on date;

-- ---- 4. verified documents stay on file -------------------------------------------------------------------------
drop policy if exists "Tutors manage own documents" on public.tutor_verification_documents;

drop policy if exists "Tutors read own documents" on public.tutor_verification_documents;
create policy "Tutors read own documents" on public.tutor_verification_documents
  for select to authenticated using (auth.uid() = tutor_id);

drop policy if exists "Tutors add own documents" on public.tutor_verification_documents;
create policy "Tutors add own documents" on public.tutor_verification_documents
  for insert to authenticated with check (auth.uid() = tutor_id);

drop policy if exists "Tutors change own unverified documents" on public.tutor_verification_documents;
create policy "Tutors change own unverified documents" on public.tutor_verification_documents
  for update to authenticated
  using (auth.uid() = tutor_id and status is distinct from 'verified')
  with check (auth.uid() = tutor_id);

drop policy if exists "Tutors remove own unverified documents" on public.tutor_verification_documents;
create policy "Tutors remove own unverified documents" on public.tutor_verification_documents
  for delete to authenticated
  using (auth.uid() = tutor_id and status is distinct from 'verified');

-- The files themselves: a tutor can still delete a file that is theirs and not yet verified (a wrong photo, a failed
-- upload), but not one that a verified document points at.
drop policy if exists "Tutors delete own documents" on storage.objects;
create policy "Tutors delete own documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tutor-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and not exists (
      select 1 from public.tutor_verification_documents d
      where d.document_url = storage.objects.name and d.status = 'verified'
    )
  );
