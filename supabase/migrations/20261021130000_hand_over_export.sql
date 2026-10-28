-- Hand-over export (CEO: "yes, build a hand-over export", 21 Oct 2026; rules in Drake/legal/handover-and-closing-rules-2026-10-21.md part A).
-- When a profile is reported for dangerous or illegal activity, the police, a court or the Information Regulator may ask for what Tutorlage
-- holds about that tutor. The admin app builds the bundle in the admin's own browser (their own rights, no service key); this migration
-- is the record and the rules behind it. Apply AFTER 20261021100000_document_access_log.sql (it needs the safety hold and the access log).
-- Adds only; replaces no existing table, policy, trigger or function.
--   * public.hand_over_events: insert-only. One 'prepared' line per bundle, written by record_hand_over() BEFORE the bundle is built (who
--     prepared it, for whom, the requester, the reference, the kind of authority, how the requester was verified, the written reason, who
--     approved it, whether the tutor was told or why not, which parts of the bundle, and what it was to contain: the list of documents);
--     and a 'delivered' line per delivery, written by record_hand_over_delivery() (method and address). Admins can read it; nobody can
--     insert, update or delete through the API; a trigger refuses update and truncate for everyone and delete too, except the retention job.
--   * public.record_hand_over(): admins only. Refuses any blank field, an unknown kind of authority, an empty bundle, and a bundle that does
--     not match the kind of authority (legal A2: a written request with the tutor's consent may not include other documents or the access
--     log; a Regulator notice always includes the access log; our own s 54 report and a request with consent always include the profile,
--     the ID copy and the hold events). It places a safety hold on the tutor if there is none (legal A3: "require, or place"), and returns
--     the list of documents the bundle is to contain, which is what the app then opens (each through log_document_access, action
--     'downloaded'), so what is recorded is what is built.
--   * public.purge_old_hand_over_events(): deletes lines older than hand_over_retention_years (default 5, legal A3); skips every line about a
--     person on a safety hold; a daily job runs it. It is the only thing that may delete a line.

create table if not exists public.hand_over_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('prepared', 'delivered')),
  hand_over_id uuid,                          -- a 'delivered' line: the 'prepared' line it belongs to
  subject_id uuid not null,                   -- the reported tutor (no foreign key: the record must outlive the account)
  admin_id uuid not null,                     -- who prepared or delivered (auth.uid() of the caller)
  admin_label text,                           -- that admin's name and email on the day
  authority text check (authority in ('s54_report', 'warrant', 'court_order', 'regulator_notice', 'request_with_consent')),
  reference text,
  requester_name text,
  requester_role text,
  requester_organisation text,
  requester_phone text,
  requester_email text,
  verified_how text,
  reason text,
  approved_by text,
  tutor_told text,
  scope text[],                               -- the parts: profile, identity, other_documents, access_log, hold_events
  contents jsonb,                             -- what the bundle was to contain (the document list and the line counts)
  delivery_method text,
  delivery_address text,
  created_at timestamptz not null default now(),
  constraint hand_over_events_shape check (
    (event = 'prepared' and hand_over_id is null and authority is not null and reference is not null and requester_name is not null
      and requester_role is not null and requester_organisation is not null and requester_phone is not null and requester_email is not null
      and verified_how is not null and reason is not null and approved_by is not null and tutor_told is not null
      and scope is not null and contents is not null)
    or (event = 'delivered' and hand_over_id is not null and delivery_method is not null and delivery_address is not null)
  )
);
create index if not exists hand_over_events_subject_idx on public.hand_over_events (subject_id, created_at desc);
create index if not exists hand_over_events_prepared_idx on public.hand_over_events (hand_over_id);

alter table public.hand_over_events enable row level security;
drop policy if exists "Admins read hand-over events" on public.hand_over_events;
create policy "Admins read hand-over events" on public.hand_over_events for select to authenticated
  using (public.is_active_admin());
-- No insert, update or delete policy exists, and no such right is granted: lines arrive only through the two functions below.
revoke all on public.hand_over_events from public, anon, authenticated, service_role;
grant select on public.hand_over_events to authenticated;

-- Update and truncate are always refused. Delete is refused unless the retention job has switched on its own transaction-local flag.
create or replace function public.hand_over_events_are_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('tutorlage.purging_hand_over_events', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Hand-over lines can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.hand_over_events_are_append_only() from public, anon, authenticated;

drop trigger if exists hand_over_events_no_change on public.hand_over_events;
create trigger hand_over_events_no_change before update or delete on public.hand_over_events
  for each row execute function public.hand_over_events_are_append_only();
drop trigger if exists hand_over_events_no_truncate on public.hand_over_events;
create trigger hand_over_events_no_truncate before truncate on public.hand_over_events
  for each statement execute function public.hand_over_events_are_append_only();

-- Written BEFORE the app builds the bundle. Returns what the bundle is to contain; the app builds exactly that.
create or replace function public.record_hand_over(
  p_subject uuid,
  p_authority text,
  p_reference text,
  p_requester_name text,
  p_requester_role text,
  p_requester_organisation text,
  p_requester_phone text,
  p_requester_email text,
  p_verified_how text,
  p_reason text,
  p_approved_by text,
  p_tutor_told text,
  p_scope text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_label text;
  v_id uuid;
  v_names text[] := array['requester name', 'requester role', 'requester organisation (station or court)', 'requester phone', 'requester email',
                          'reference', 'how the requester was verified', 'reason', 'who approved it', 'whether the tutor was told, or why not'];
  v_vals text[] := array[p_requester_name, p_requester_role, p_requester_organisation, p_requester_phone, p_requester_email,
                         p_reference, p_verified_how, p_reason, p_approved_by, p_tutor_told];
  v_parts constant text[] := array['profile', 'identity', 'other_documents', 'access_log', 'hold_events'];
  v_required text[];
  v_forbidden text[];
  v_docs jsonb;
  v_log_lines bigint := 0;
  v_hold_lines bigint := 0;
  v_placed boolean := false;
  v_contents jsonb;
  v_created timestamptz;
  s text;
  i integer;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_subject is null or not exists (select 1 from public.tutor_profiles t where t.id = p_subject) then
    raise exception 'No such tutor' using errcode = 'P0002';
  end if;
  if p_authority is null or p_authority not in ('s54_report', 'warrant', 'court_order', 'regulator_notice', 'request_with_consent') then
    raise exception 'Say what kind of authority this is' using errcode = '22023';
  end if;
  for i in 1 .. array_length(v_names, 1) loop
    if v_vals[i] is null or length(btrim(v_vals[i])) < 3 or length(v_vals[i]) > 2000 then
      raise exception 'Fill in: %', v_names[i] using errcode = '22023';
    end if;
  end loop;
  if btrim(p_requester_email) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'Fill in: requester email' using errcode = '22023';
  end if;

  -- The bundle is built to the authority, not to what the database holds (legal A2).
  if p_scope is null or cardinality(p_scope) = 0 then
    raise exception 'Pick what the paper names' using errcode = '22023';
  end if;
  foreach s in array p_scope loop
    if s is null or not (s = any (v_parts)) then
      raise exception 'Unknown part of the bundle: %', coalesce(s, 'blank') using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct x) from unnest(p_scope) x) <> cardinality(p_scope) then
    raise exception 'Name each part once' using errcode = '22023';
  end if;
  v_required := case p_authority
    when 's54_report' then array['profile', 'identity', 'hold_events']
    when 'request_with_consent' then array['profile', 'identity', 'hold_events']
    when 'regulator_notice' then array['access_log']
    else array[]::text[] end;
  v_forbidden := case p_authority
    when 'request_with_consent' then array['other_documents', 'access_log']
    else array[]::text[] end;
  foreach s in array v_required loop
    if not (s = any (p_scope)) then
      raise exception 'This kind of authority always includes: %', s using errcode = '22023';
    end if;
  end loop;
  foreach s in array v_forbidden loop
    if s = any (p_scope) then
      raise exception 'This kind of authority may not include: %', s using errcode = '22023';
    end if;
  end loop;

  select format('%s %s <%s>', a.first_name, a.surname, a.email) into v_label from public.admin_profiles a where a.id = v_admin;

  -- A bundle for the police or the Regulator means the tutor's data must stay: place a safety hold if there is none (same lock as place_safety_hold).
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || p_subject::text, 0));
  if not public.profile_is_on_safety_hold(p_subject) then
    insert into public.safety_hold_events (profile_id, event, reason, admin_id, admin_label)
    values (p_subject, 'placed', left('Hand-over prepared (' || btrim(p_reference) || '): ' || btrim(p_reason), 2000), v_admin, v_label);
    v_placed := true;
  end if;

  -- The documents the bundle is to contain: the ID copy under 'identity', every other document under 'other_documents'. Notes written by
  -- reviewers are left out (facts and dates only).
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'type', d.document_type::text, 'path', d.document_url, 'status', d.status::text,
           'uploaded_at', d.uploaded_at, 'reviewed_at', d.reviewed_at, 'issued_on', d.issued_on) order by d.uploaded_at, d.id), '[]'::jsonb)
    into v_docs
  from public.tutor_verification_documents d
  where d.tutor_id = p_subject
    and ((d.document_type = 'identity_doc' and 'identity' = any (p_scope))
      or (d.document_type <> 'identity_doc' and 'other_documents' = any (p_scope)));
  if 'access_log' = any (p_scope) then
    select count(*) into v_log_lines from public.document_access_log l where l.subject_id = p_subject;
  end if;
  if 'hold_events' = any (p_scope) then
    select count(*) into v_hold_lines from public.safety_hold_events e where e.profile_id = p_subject;
  end if;
  v_contents := jsonb_build_object('documents', v_docs, 'access_log_lines_at_start', v_log_lines, 'hold_lines_at_start', v_hold_lines,
                                   'hold_placed_by_this_hand_over', v_placed);

  insert into public.hand_over_events (event, subject_id, admin_id, admin_label, authority, reference, requester_name, requester_role,
    requester_organisation, requester_phone, requester_email, verified_how, reason, approved_by, tutor_told, scope, contents)
  values ('prepared', p_subject, v_admin, v_label, p_authority, btrim(p_reference), btrim(p_requester_name), btrim(p_requester_role),
    btrim(p_requester_organisation), btrim(p_requester_phone), btrim(p_requester_email), btrim(p_verified_how), btrim(p_reason),
    btrim(p_approved_by), btrim(p_tutor_told), p_scope, v_contents)
  returning id, created_at into v_id, v_created;

  return v_contents || jsonb_build_object('id', v_id, 'created_at', v_created, 'prepared_by', v_label);
end;
$$;
revoke all on function public.record_hand_over(uuid, text, text, text, text, text, text, text, text, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.record_hand_over(uuid, text, text, text, text, text, text, text, text, text, text, text, text[]) to authenticated;

-- One line each time a prepared bundle is handed to someone (legal A3: date and time from the database clock, method, address).
create or replace function public.record_hand_over_delivery(p_hand_over uuid, p_method text, p_address text)
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
  v_id uuid;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select e.subject_id into v_subject from public.hand_over_events e where e.id = p_hand_over and e.event = 'prepared';
  if v_subject is null then
    raise exception 'No such hand-over' using errcode = 'P0002';
  end if;
  if p_method is null or length(btrim(p_method)) < 3 or length(p_method) > 500 then
    raise exception 'Fill in: how it was delivered' using errcode = '22023';
  end if;
  if p_address is null or length(btrim(p_address)) < 3 or length(p_address) > 500 then
    raise exception 'Fill in: the address it was delivered to' using errcode = '22023';
  end if;
  select format('%s %s <%s>', a.first_name, a.surname, a.email) into v_label from public.admin_profiles a where a.id = v_admin;
  insert into public.hand_over_events (event, hand_over_id, subject_id, admin_id, admin_label, delivery_method, delivery_address)
  values ('delivered', p_hand_over, v_subject, v_admin, v_label, btrim(p_method), btrim(p_address))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_hand_over_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_hand_over_delivery(uuid, text, text) to authenticated;

-- Retention (legal A3: 5 years, longer while the person is on a safety hold). The only thing that may delete a line.
insert into public.system_settings (setting_key, setting_value, description) values
  ('hand_over_retention_years', '5'::jsonb, 'How many years a hand-over line is kept before the daily job deletes it (never while the person is on a safety hold).')
on conflict (setting_key) do nothing;

create or replace function public.purge_old_hand_over_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_years integer := 5;
  n integer;
begin
  begin
    select coalesce(nullif(s.setting_value #>> '{}', '')::integer, 5) into v_years
    from public.system_settings s where s.setting_key = 'hand_over_retention_years';
  exception when others then
    v_years := 5;
  end;
  if v_years is null or v_years < 1 then
    v_years := 5;
  end if;
  perform set_config('tutorlage.purging_hand_over_events', 'on', true);
  delete from public.hand_over_events e
  where e.created_at < now() - make_interval(years => v_years)
    and not public.profile_is_on_safety_hold(e.subject_id);
  get diagnostics n = row_count;
  perform set_config('tutorlage.purging_hand_over_events', 'off', true);
  return n;
end;
$$;
revoke all on function public.purge_old_hand_over_events() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-hand-over-events') where exists (select 1 from cron.job where jobname = 'purge-hand-over-events');
    perform cron.schedule('purge-hand-over-events', '57 3 * * *', 'select public.purge_old_hand_over_events();');
  end if;
end $$;
