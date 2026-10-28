-- Document access log (legal flag H4, CEO's "Build the log", 21 Oct 2026; requirements in Drake/legal/doc-open-log-requirements-2026-10-21.md).
-- Privacy §7 says: "Only the staff who check documents can see them, and we record each time one is opened."
-- Until now the admin app opened a stored file by a five-minute link and wrote nothing down. This adds:
--   * public.document_access_log: one row each time an admin opens a stored document: who (id, and name and email as they were that day),
--     whose document, which file (path, type, and the document's row id when it is a verification document), what, and when.
--     Insert-only: no browser role can insert, update or delete; a trigger refuses update and truncate for everyone, owner included,
--     and refuses delete too except inside the retention job below.
--   * public.log_document_access(): the ONE way a row is added. The admin app calls it before it asks Storage for a link. It checks the
--     caller is an active admin, that the file really exists, and takes the time from the database clock; the caller cannot say who they
--     are or when. (The companion migration 20261021103000 makes Storage itself refuse a link that has no fresh row.)
--   * public.purge_old_document_access_log(): deletes lines older than the retention period (setting document_access_log_retention_years,
--     default 3, legal's suggestion, the CEO's to change); a daily job runs it. It is the only thing that may delete a line, and it skips
--     every line about a person who is on a safety hold.
--   * public.safety_hold_events + place_safety_hold() / release_safety_hold() (CEO, 21 Oct 2026: the data must stay retrievable when a
--     profile has been reported for dangerous or illegal activities). An admin places a hold with a written reason and releases it with a
--     written note; each is an insert-only line (who, when, why). A hold only stops the retention job above; it deletes and blocks nothing else.
-- Admins can read the log and the hold events. Nobody else can read or write either.
-- No foreign keys on purpose: the log must outlive a deleted account, and a cascade would be a delete the trigger refuses.
-- Additive only: no existing table, policy or function is changed (one new setting row is added).

create table if not exists public.document_access_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,                     -- who opened it (auth.uid() of the caller)
  admin_label text,                           -- that admin's name and email on the day, so the line still reads if the account is removed
  subject_id uuid not null,                   -- whose document: the tutor, or the learner for school results
  bucket text not null check (bucket in ('tutor-documents', 'school-results')),
  document_path text not null check (length(document_path) between 1 and 500),
  document_id uuid,                           -- the verification document's row id, when the file is one
  document_type text,                         -- e.g. police_clearance, when the file is a known verification document
  action text not null check (action in ('opened', 'downloaded')),
  created_at timestamptz not null default now()
);
create index if not exists document_access_log_subject_idx on public.document_access_log (subject_id, created_at desc);
create index if not exists document_access_log_admin_idx on public.document_access_log (admin_id, created_at desc);

alter table public.document_access_log enable row level security;
drop policy if exists "Admins read the document access log" on public.document_access_log;
create policy "Admins read the document access log" on public.document_access_log for select to authenticated
  using (public.is_active_admin());
-- No insert, update or delete policy exists, and no insert, update or delete right is granted: rows arrive only through the function below.
revoke all on public.document_access_log from public, anon, authenticated, service_role;
grant select on public.document_access_log to authenticated;

-- Update and truncate are always refused. Delete is refused unless the retention job has switched on its own transaction-local flag
-- (an API role cannot delete in the first place: it holds no delete right).
create or replace function public.document_access_log_is_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('tutorlage.purging_document_log', true), '') = 'on' then
    return old;
  end if;
  raise exception 'The document access log can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.document_access_log_is_append_only() from public, anon, authenticated;

drop trigger if exists document_access_log_no_change on public.document_access_log;
create trigger document_access_log_no_change before update or delete on public.document_access_log
  for each row execute function public.document_access_log_is_append_only();
drop trigger if exists document_access_log_no_truncate on public.document_access_log;
create trigger document_access_log_no_truncate before truncate on public.document_access_log
  for each statement execute function public.document_access_log_is_append_only();

create or replace function public.log_document_access(
  p_bucket text,
  p_path text,
  p_action text default 'opened',
  p_subject uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_label text;
  v_subject uuid;
  v_folder text;
  v_docid uuid;
  v_type text;
  v_id uuid;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_bucket is null or p_bucket not in ('tutor-documents', 'school-results') then
    raise exception 'Unknown document store' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('opened', 'downloaded') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  if p_path is null or length(btrim(p_path)) = 0 or length(p_path) > 500 or p_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'Give the stored path of the document' using errcode = '22023';
  end if;

  if p_path ~* '^https?://' then
    -- A web address kept as a document (proof of experience can be a link): there is no stored file, so the caller says whose it is.
    if p_subject is null then
      raise exception 'Say whose document this is' using errcode = '22023';
    end if;
    v_subject := p_subject;
  else
    -- A stored file lives in its owner's folder: <owner id>/<file>. The owner is read from the path, never trusted from the caller.
    -- A file kept outside an owner folder (put there by hand) can still be opened: the caller then says whose it is, so no stored file
    -- is ever out of an admin's reach.
    v_folder := split_part(p_path, '/', 1);
    if v_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_subject := v_folder::uuid;
      if p_subject is not null and p_subject <> v_subject then
        raise exception 'That path belongs to someone else' using errcode = '22023';
      end if;
    elsif p_subject is not null then
      v_subject := p_subject;
    else
      raise exception 'The path does not start with the owner''s folder' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
      raise exception 'No such stored document' using errcode = 'P0002';
    end if;
  end if;

  if p_bucket = 'tutor-documents' then
    select d.id, d.document_type::text into v_docid, v_type
    from public.tutor_verification_documents d
    where d.tutor_id = v_subject and d.document_url = p_path
    limit 1;
  else
    v_type := 'school_result';
  end if;

  select format('%s %s <%s>', a.first_name, a.surname, a.email) into v_label from public.admin_profiles a where a.id = v_admin;

  insert into public.document_access_log (admin_id, admin_label, subject_id, bucket, document_path, document_id, document_type, action)
  values (v_admin, v_label, v_subject, p_bucket, p_path, v_docid, v_type, p_action)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.log_document_access(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_document_access(text, text, text, uuid) to authenticated;

-- Retention (legal: 3 years after each line is written, then a daily job deletes it). Lines of a tutor involved in a safety report or
-- investigation are kept longer by placing a safety hold on them (above); otherwise the job deletes by age only.
insert into public.system_settings (setting_key, setting_value, description) values
  ('document_access_log_retention_years', '3'::jsonb, 'How many years a line of the document access log is kept before the daily job deletes it.')
on conflict (setting_key) do nothing;

-- Safety hold -----------------------------------------------------------------------------------------------------------------
-- One insert-only line each time an admin places or releases a hold on a person. A person is on hold when their latest line says
-- 'placed'. No foreign key on purpose (the record must outlive the account). Only admins can read it; only the two functions below write it.
create table if not exists public.safety_hold_events (
  seq bigint generated always as identity primary key,
  profile_id uuid not null,                   -- the person the hold is on
  event text not null check (event in ('placed', 'released')),
  reason text not null check (length(btrim(reason)) between 3 and 2000),   -- why it was placed, or the note on releasing it
  admin_id uuid not null,
  admin_label text,
  created_at timestamptz not null default now()
);
create index if not exists safety_hold_events_profile_idx on public.safety_hold_events (profile_id, seq desc);

alter table public.safety_hold_events enable row level security;
drop policy if exists "Admins read safety hold events" on public.safety_hold_events;
create policy "Admins read safety hold events" on public.safety_hold_events for select to authenticated
  using (public.is_active_admin());
revoke all on public.safety_hold_events from public, anon, authenticated, service_role;
grant select on public.safety_hold_events to authenticated;

create or replace function public.safety_hold_events_are_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Safety hold lines can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.safety_hold_events_are_append_only() from public, anon, authenticated;

drop trigger if exists safety_hold_events_no_change on public.safety_hold_events;
create trigger safety_hold_events_no_change before update or delete on public.safety_hold_events
  for each row execute function public.safety_hold_events_are_append_only();
drop trigger if exists safety_hold_events_no_truncate on public.safety_hold_events;
create trigger safety_hold_events_no_truncate before truncate on public.safety_hold_events
  for each statement execute function public.safety_hold_events_are_append_only();

-- Used by the retention job only; not callable through the API.
create or replace function public.profile_is_on_safety_hold(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select e.event = 'placed' from public.safety_hold_events e where e.profile_id = p_profile order by e.seq desc limit 1), false);
$$;
revoke all on function public.profile_is_on_safety_hold(uuid) from public, anon, authenticated;

create or replace function public.place_safety_hold(p_profile uuid, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_label text;
  v_seq bigint;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_profile is null or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 2000 then
    raise exception 'Say why: a short written reason is needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || p_profile::text, 0));
  if public.profile_is_on_safety_hold(p_profile) then
    raise exception 'This person is already on a safety hold' using errcode = '23505';
  end if;
  select format('%s %s <%s>', a.first_name, a.surname, a.email) into v_label from public.admin_profiles a where a.id = v_admin;
  insert into public.safety_hold_events (profile_id, event, reason, admin_id, admin_label)
  values (p_profile, 'placed', btrim(p_reason), v_admin, v_label)
  returning seq into v_seq;
  return v_seq;
end;
$$;
revoke all on function public.place_safety_hold(uuid, text) from public, anon, authenticated;
grant execute on function public.place_safety_hold(uuid, text) to authenticated;

create or replace function public.release_safety_hold(p_profile uuid, p_note text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_label text;
  v_seq bigint;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_note is null or length(btrim(p_note)) < 3 or length(p_note) > 2000 then
    raise exception 'Say why: a short written note is needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || coalesce(p_profile::text, ''), 0));
  if p_profile is null or not public.profile_is_on_safety_hold(p_profile) then
    raise exception 'This person is not on a safety hold' using errcode = 'P0002';
  end if;
  select format('%s %s <%s>', a.first_name, a.surname, a.email) into v_label from public.admin_profiles a where a.id = v_admin;
  insert into public.safety_hold_events (profile_id, event, reason, admin_id, admin_label)
  values (p_profile, 'released', btrim(p_note), v_admin, v_label)
  returning seq into v_seq;
  return v_seq;
end;
$$;
revoke all on function public.release_safety_hold(uuid, text) from public, anon, authenticated;
grant execute on function public.release_safety_hold(uuid, text) to authenticated;

create or replace function public.purge_old_document_access_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_years integer := 3;
  n integer;
begin
  begin
    select coalesce(nullif(s.setting_value #>> '{}', '')::integer, 3) into v_years
    from public.system_settings s where s.setting_key = 'document_access_log_retention_years';
  exception when others then
    v_years := 3;
  end;
  if v_years is null or v_years < 1 then
    v_years := 3;
  end if;
  perform set_config('tutorlage.purging_document_log', 'on', true);
  -- A line about a person on a safety hold is never deleted, however old it is.
  delete from public.document_access_log l
  where l.created_at < now() - make_interval(years => v_years)
    and not public.profile_is_on_safety_hold(l.subject_id);
  get diagnostics n = row_count;
  perform set_config('tutorlage.purging_document_log', 'off', true);
  return n;
end;
$$;
revoke all on function public.purge_old_document_access_log() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-document-access-log') where exists (select 1 from cron.job where jobname = 'purge-document-access-log');
    perform cron.schedule('purge-document-access-log', '47 3 * * *', 'select public.purge_old_document_access_log();');
  end if;
end $$;
