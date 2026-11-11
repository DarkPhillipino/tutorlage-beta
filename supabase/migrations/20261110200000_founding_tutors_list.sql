-- THE FOUNDING TUTORS LIST (CEO's order of 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md sections 8, 9 (P-1 to P-4) and 11;
-- words in Drake/marketing-gtm/founding-tutors-drafts-2026-11-10.md). Programmer A's piece: the list table, the page's counters, the admin's reads and writes,
-- and the Teach gate (four states, enforced here, ONE switch, shipped OFF).
--
-- WHAT THIS MIGRATION ADDS (it replaces and drops NOTHING that exists; with the switch off nothing about any existing screen or rule changes):
--   NEW  table    public.founding_tutors_list           one row per person on the list (the form's fields, two consents with their own timestamps, status, dates, delete date)
--   NEW  table    public.founding_page_events           anonymous page counters: a random visitor id, the event, the ?src= tag, the time (no personal data)
--   NEW  setting  system_settings 'founding_tutors_gate'  {"on": false}: THE switch. Off = everybody behaves exactly as before. Turned on only by a super admin, and only
--                                                          when every existing tutor account is covered (admin_set_founding_gate)
--   NEW  functions (public page, signed-out allowed)    join_founding_list(jsonb), log_founding_event(text, text, text)
--   NEW  functions (signed-in app)                       my_founding_gate(), founding_gate_allows_documents(), founding_gate_on()
--   NEW  functions (admin app: verification officer or super admin)
--                 admin_founding_entries(), admin_founding_coverage(), admin_founding_funnel(int), admin_release_founding(uuid[]),
--                 admin_mark_founding_messaged(uuid, text), admin_set_founding_status(uuid, text), admin_add_founding_entry(text, text, text, text, text),
--                 admin_founding_gate_check(), admin_set_founding_gate(boolean)
--   NEW  helpers  founding_gate_state(uuid), founding_gate_state_raw(uuid), founding_admin_ok(), founding_phase_of(text), founding_phases(text, text), tidy_za_mobile(text)
--   NEW  function purge_expired_founding_entries() + a daily pg_cron job (founding_daily_job): removes entries past their delete date and page counters older than 90 days, and
--        lapses a released person with no account 14 days after the release message (lapse_founding_releases)
--   NEW  also (Marketing's R1 to R3, R7 and the PM's additions, 11 Nov): admin_founding_hourly, admin_set_founding_tags, admin_founding_tags, admin_delete_founding_entry,
--        founding_count_rows, founding_tag_registered; the event 'code_open' (the Codes page's counter for ?code= links); a trigger on tutor_profiles that links an entry to the
--        account (user_id) at sign-up and can never stop a sign-up; settings founding_tag_registry and founding_release_lapse_days
--   NEW  also (the PM's list after Programmer C's report, 11 Nov; section 13 at the end): a BEFORE INSERT trigger on tutor_profiles that refuses a tutor profile to a person whose
--        place has not opened (it covers all three paths: the sign-up trigger, convert_new_account_role, the "Tutors insert own profile" policy); a trigger on video_rooms so only a
--        verified tutor opens a room while the switch is ON; tutor_onboarding.completed_at (stamped the first time the "finished" rule is met) and tutor_profiles.first_request_seen_at
--        (set once by note_first_request_seen(), called by the Teach screen); and "ready" / "missing" in admin_founding_entries for the "Verified: message ready" button
--   NEW  enforcement (all pass at once while the switch is off):
--        * a RESTRICTIVE policy on tutor_verification_documents (insert) and one on storage.objects (insert into the tutor documents bucket)
--        * a trigger on tutor_onboarding (a tutor choosing a type or agreeing to the documents wording)
--   NEW  BACKFILL: one list row for every tutor profile that exists today (status 'verified' if the tutor is verified, else 'released'), so nobody is locked out.
--
-- THE FOUR STATES (D5): not_listed -> Teach says "join the list"; waiting (on the list, not released) -> "wait to be verified"; released -> the existing onboarding and
-- document upload; verified -> the full tutor side. 'open' is what everybody is while the switch is off (and at Phase 4, when it is switched off again).
-- WHAT "ENFORCED" MEANS HERE: accepting a request already needs tutor_profiles.is_verified (claim_session_request / accept_session_request, 20261020180000), and
-- nobody can be verified without documents (enforce_tutor_documents_on_verify), so the two early states cannot accept. This migration closes the rest: they cannot
-- upload a document (table AND file), and they cannot choose a tutor type or agree to the documents wording. A tutor ACCOUNT can still be made by anyone (the sign-up
-- trigger is not touched, so sign-up can never break); what the account can DO is what the gate decides.
-- WHO IS "ON THE LIST": the list row's email equals the account's email (the form asks for "the email you will use to sign up"), or the row is linked to the account.
-- The email match is read from auth.users inside the SECURITY DEFINER functions; the app never sees another person's email.
-- PRIVACY: the list table has NO grant and NO policy for any API role: it is read and written only through the functions above. The page counters hold no personal
-- data. A person's entry is deleted at its delete date (30 days after the place opens, or 6 months after joining; never while an account exists for it).

-- 1. the switch ---------------------------------------------------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values (
  'founding_tutors_gate',
  jsonb_build_object('on', false),
  'The Teach gate for the founding tutors list. {"on": false} = everyone behaves as before. Turn it on only from the admin app''s Founding tutors page (it checks that every existing tutor is covered first); turn it off at Phase 4 (Open).'
)
on conflict (setting_key) do nothing;

-- The tags Marketing has registered (a JSON list; a trailing * registers every tag that starts that way, for example "ref-*"). A tag seen on the page that is not in
-- this list still counts but is shown on the admin page under "tags not in the registry". Tags starting "test" are never counted. Edited from the admin page.
insert into public.system_settings (setting_key, setting_value, description) values (
  'founding_tag_registry',
  '["f1", "f1-n1", "f1-n2", "ceo", "app", "ref-*"]'::jsonb,
  'The registered source tags for the founding tutors page (a trailing * registers a prefix). Edit it on the admin Founding tutors page.'
)
on conflict (setting_key) do nothing;

-- How many days a released person has to make an account (counted from the day the release message was marked as sent) before they go back to "on the list".
insert into public.system_settings (setting_key, setting_value, description) values (
  'founding_release_lapse_days',
  '14'::jsonb,
  'Days a released founding tutor has to create an account before they return to the list (counted from the release message).'
)
on conflict (setting_key) do nothing;

create or replace function public.founding_gate_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.setting_value ->> 'on' = 'true' from public.system_settings s where s.setting_key = 'founding_tutors_gate'), false);
$$;
revoke all on function public.founding_gate_on() from public, anon;
grant execute on function public.founding_gate_on() to authenticated;

-- 2. small helpers ------------------------------------------------------------------------------------------------------------------------------
-- A South African mobile number as +27XXXXXXXXX, or null when it cannot be one. Accepts 082 123 4567, 0821234567, +27 82 123 4567, 27821234567, 0027821234567,
-- +27 (0) 82 123 4567 and 821234567. Mobile only (06x, 07x, 08x): it is a WhatsApp number.
create or replace function public.tidy_za_mobile(p_raw text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  d text;
begin
  if p_raw is null then return null; end if;
  d := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if d like '0027%' then d := substr(d, 3); end if;
  if d like '270%' and length(d) = 12 then d := '27' || substr(d, 4); end if;   -- "+27 (0) 82 ..."
  if d like '0%' and length(d) = 10 then d := '27' || substr(d, 2); end if;
  if length(d) = 9 and d ~ '^[6-8]' then d := '27' || d; end if;
  if d ~ '^27[6-8][0-9]{8}$' then return '+' || d; end if;
  return null;
end;
$$;
revoke all on function public.tidy_za_mobile(text) from public, anon, authenticated, service_role;

-- The school phase of one grade (the admin filters and the coverage view use these names).
create or replace function public.founding_phase_of(p_grade text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_grade in ('Grade R', 'Grade 1', 'Grade 2', 'Grade 3') then 'Foundation (R-3)'
    when p_grade in ('Grade 4', 'Grade 5', 'Grade 6') then 'Intermediate (4-6)'
    when p_grade in ('Grade 7', 'Grade 8', 'Grade 9') then 'Senior (7-9)'
    when p_grade in ('Grade 10', 'Grade 11', 'Grade 12') then 'FET (10-12)'
    else 'University and adult'
  end;
$$;
revoke all on function public.founding_phase_of(text) from public, anon, authenticated, service_role;

-- The phases a grade range touches (from grade_levels' own order, so a range that spans two phases counts in both).
create or replace function public.founding_phases(p_min text, p_max text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct public.founding_phase_of(g.name)), '{}'::text[])
  from public.grade_levels g
  where g.sort_order between (select a.sort_order from public.grade_levels a where a.name = p_min)
                         and (select b.sort_order from public.grade_levels b where b.name = p_max);
$$;
revoke all on function public.founding_phases(text, text) from public, anon, authenticated, service_role;

-- 3. the tables ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.founding_tutors_list (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'form' = the public page; 'admin' = added by hand in the admin app; 'backfill' = a tutor account that already existed (only user_id and status are filled)
  source text not null default 'form',
  full_name text,
  code_name text,
  whatsapp text,
  email text,
  email_key text,
  user_id uuid,
  is_adult boolean,
  -- [{"subject": "Mathematics", "min_grade": "Grade 8", "max_grade": "Grade 12"}], names exactly as the app's own subject and grade lists spell them
  subjects jsonb not null default '[]'::jsonb,
  availability text[] not null default '{}'::text[],
  unavailable_weeks text,
  practicum text,
  police_clearance text,
  parent_reach text,
  parent_reach_willing boolean,
  prior_tutoring text,
  heard_from text,
  has_device boolean not null default false,
  has_connection boolean not null default false,
  has_bank boolean not null default false,
  consent_contact_at timestamptz,
  consent_marketing_at timestamptz,
  consent_version text,
  src text,
  status text not null default 'joined',
  released_at timestamptz,
  released_messaged_at timestamptz,
  verified_messaged_at timestamptz,
  -- the CEO sent the "Still waiting" update (drafts 5b); marked from the admin page, the app sends nothing
  waiting_messaged_at timestamptz,
  -- set by the daily job when a released person had no account 14 days after the "place is open" message (they go back to 'joined'); cleared by a new release
  lapsed_at timestamptz,
  delete_after timestamptz,
  admin_note text,
  constraint founding_list_user_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint founding_list_source_values check (source in ('form', 'admin', 'backfill')),
  constraint founding_list_status_values check (status in ('joined', 'released', 'signed_up', 'verified')),
  constraint founding_list_form_fields check (
    source = 'backfill' or (full_name is not null and code_name is not null and whatsapp is not null and email is not null and email_key is not null)),
  constraint founding_list_practicum_values check (practicum is null or practicum in ('none', 'one', 'two', 'three_plus')),
  constraint founding_list_police_values check (police_clearance is null or police_clearance in ('have', 'applied', 'not_yet')),
  constraint founding_list_reach_values check (parent_reach is null or parent_reach in ('none', 'up_to_10', '10_to_30', 'over_30')),
  constraint founding_list_heard_values check (heard_from is null or heard_from in ('message', 'friend', 'other'))
);
create unique index if not exists founding_tutors_list_email_key_idx on public.founding_tutors_list (email_key) where email_key is not null;
create unique index if not exists founding_tutors_list_user_idx on public.founding_tutors_list (user_id) where user_id is not null;
create index if not exists founding_tutors_list_status_idx on public.founding_tutors_list (status, created_at desc);
create index if not exists founding_tutors_list_delete_idx on public.founding_tutors_list (delete_after) where delete_after is not null;

alter table public.founding_tutors_list enable row level security;
revoke all on public.founding_tutors_list from public, anon, authenticated, service_role;
-- No policy and no grant on purpose: every read and write goes through the SECURITY DEFINER functions below.

create table if not exists public.founding_page_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  event text not null,
  -- the tag the link carried (null when none); first_src is the visitor's FIRST tag ever seen (the page keeps it beside the visitor id)
  src text,
  first_src text,
  constraint founding_events_event_values check (event in ('open', 'see_more', 'form_start', 'join', 'code_open'))
);
create index if not exists founding_page_events_created_idx on public.founding_page_events (created_at desc);
create index if not exists founding_page_events_visitor_idx on public.founding_page_events (visitor_id, created_at desc);
alter table public.founding_page_events enable row level security;
revoke all on public.founding_page_events from public, anon, authenticated, service_role;

-- 4. who is an admin for this page --------------------------------------------------------------------------------------------------------------
create or replace function public.founding_admin_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles a
                 where a.id = auth.uid() and a.is_active and a.admin_role in ('verification_officer', 'super_admin'));
$$;
revoke all on function public.founding_admin_ok() from public, anon;
grant execute on function public.founding_admin_ok() to authenticated;

-- 5. the gate state of one person ---------------------------------------------------------------------------------------------------------------
-- RAW: what the list says about the person, whatever the switch is. 'verified' (is_verified, or the list row says verified) | 'released' (released or signed up) |
-- 'waiting' (on the list, not released) | 'not_listed'.
create or replace function public.founding_gate_state_raw(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  e record;
begin
  if p_uid is null then return 'not_listed'; end if;
  if exists (select 1 from public.tutor_profiles tp where tp.id = p_uid and tp.is_verified) then return 'verified'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_uid;
  select f.status into e
  from public.founding_tutors_list f
  where f.user_id = p_uid or (v_email is not null and f.email_key = v_email)
  order by (f.user_id = p_uid) desc, f.created_at
  limit 1;
  if not found then return 'not_listed'; end if;
  return case e.status when 'verified' then 'verified' when 'released' then 'released' when 'signed_up' then 'released' else 'waiting' end;
end;
$$;
revoke all on function public.founding_gate_state_raw(uuid) from public, anon, authenticated, service_role;

-- What the rules use: 'open' while the switch is off, else the raw state.
create or replace function public.founding_gate_state(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_gate_on() then return 'open'; end if;
  return public.founding_gate_state_raw(p_uid);
end;
$$;
revoke all on function public.founding_gate_state(uuid) from public, anon, authenticated, service_role;

-- The two questions a signed-in person's own session may ask (about themselves only).
create or replace function public.founding_gate_allows_documents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.founding_gate_state(auth.uid()) in ('open', 'released', 'verified');
$$;
revoke all on function public.founding_gate_allows_documents() from public, anon;
grant execute on function public.founding_gate_allows_documents() to authenticated;

create or replace function public.my_founding_gate()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('gate_on', public.founding_gate_on(), 'state', public.founding_gate_state(auth.uid()));
$$;
revoke all on function public.my_founding_gate() from public, anon;
grant execute on function public.my_founding_gate() to authenticated;

-- 6. enforcement (every check passes while the switch is off) -----------------------------------------------------------------------------------
drop policy if exists "Founding gate: documents once a place has opened" on public.tutor_verification_documents;
create policy "Founding gate: documents once a place has opened" on public.tutor_verification_documents
  as restrictive for insert to authenticated
  with check (public.founding_gate_allows_documents() or public.is_active_admin());

drop policy if exists "Founding gate: tutor files once a place has opened" on storage.objects;
create policy "Founding gate: tutor files once a place has opened" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'tutor-documents' or public.founding_gate_allows_documents() or public.is_active_admin());

create or replace function public.founding_gate_onboarding_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a tutor's own call is held to the gate (the owner running SQL, an admin and the grandfathering backfill are not).
  if auth.uid() is not null and new.tutor_id = auth.uid() and not public.founding_gate_allows_documents() then
    raise exception 'Your place has not opened yet. We will message you when it does.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.founding_gate_onboarding_guard() from public, anon, authenticated, service_role;

drop trigger if exists founding_gate_onboarding_guard on public.tutor_onboarding;
create trigger founding_gate_onboarding_guard before insert or update on public.tutor_onboarding
  for each row execute function public.founding_gate_onboarding_guard();

-- 7. the public page: joining and counting ------------------------------------------------------------------------------------------------------
-- Everything the page sends is checked again here. A bot gets a plain "ok" and nothing is stored: the hidden field (website) must be empty and the form must have
-- been open at least 4 seconds. The same email twice gives the same answer as the first time and stores nothing (so the page cannot be used to ask who is on the list).
-- The caps are crude on purpose: at most 200 joins an hour for the whole list.
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
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Something went wrong. Please try again.' using errcode = '22023';
  end if;

  -- the bot trap
  if coalesce(btrim(p ->> 'website'), '') <> '' then return jsonb_build_object('ok', true); end if;
  if (case when coalesce(p ->> 'elapsed_ms', '') ~ '^[0-9]{1,9}$' then (p ->> 'elapsed_ms')::bigint < 4000 else true end) then
    return jsonb_build_object('ok', true);
  end if;

  v_name := btrim(coalesce(p ->> 'full_name', ''), E' \t\r\n');
  if char_length(v_name) < 2 or char_length(v_name) > 100 or v_name ~ '[<>[:cntrl:]]' then
    raise exception 'Please enter your full name.' using errcode = '22023';
  end if;
  v_code := btrim(coalesce(p ->> 'code_name', ''), E' \t\r\n');
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
  if coalesce(p ->> 'is_adult', '') <> 'true' then
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
    source, full_name, code_name, whatsapp, email, email_key, is_adult, subjects, availability, unavailable_weeks, practicum, police_clearance,
    parent_reach, parent_reach_willing, prior_tutoring, heard_from, has_device, has_connection, has_bank,
    consent_contact_at, consent_marketing_at, consent_version, src, status, delete_after)
  values (
    'form', v_name, v_code, v_wa, v_email, v_email, true, v_subjects, v_avail,
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

-- One count of the page: 'open', 'see_more' or 'form_start' (a join is counted by join_founding_list itself, so it cannot be claimed without a real entry).
-- Anything odd is ignored without an error. At most 30 counts an hour per visitor id.
create or replace function public.log_founding_event(p_visitor text, p_event text, p_src text default null, p_first text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vis uuid;
  v_src text;
  v_first text;
  v_n integer;
begin
  -- 'code_open' is the family page's counter for a ?code= link (the Codes page reads it): the code, lower-cased, travels in src. It is not one of the page counters above.
  if p_event is null or p_event not in ('open', 'see_more', 'form_start', 'code_open') then return; end if;
  if p_visitor is null or p_visitor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
  v_vis := p_visitor::uuid;
  v_src := lower(btrim(coalesce(p_src, '')));
  if v_src !~ '^[a-z0-9_-]{1,32}$' then v_src := null; end if;
  v_first := lower(btrim(coalesce(p_first, '')));
  if v_first !~ '^[a-z0-9_-]{1,32}$' then v_first := v_src; end if;
  select count(*) into v_n from public.founding_page_events where visitor_id = v_vis and created_at > now() - interval '1 hour';
  if v_n >= 30 then return; end if;
  insert into public.founding_page_events (visitor_id, event, src, first_src) values (v_vis, p_event, v_src, v_first);
end;
$$;
revoke all on function public.log_founding_event(text, text, text, text) from public;
grant execute on function public.log_founding_event(text, text, text, text) to anon, authenticated;

-- 8. the admin's reads ---------------------------------------------------------------------------------------------------------------------------
-- Every entry with what the account says now: has an account, is verified, weekly hours, and the phases its subjects touch. The "effective status" is the stored one
-- moved forward by what is true: an account that is verified is 'verified'; a released entry whose person has an account is 'signed_up'.
create or replace function public.admin_founding_entries()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the founding tutors list' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(t.j order by t.created_at desc)
    from (
      select f.created_at,
        jsonb_build_object(
          'id', f.id, 'created_at', f.created_at, 'source', f.source,
          'full_name', coalesce(f.full_name, pr.full_name), 'code_name', f.code_name, 'whatsapp', f.whatsapp, 'email', f.email,
          'is_adult', f.is_adult, 'subjects', f.subjects, 'phases', ph.phases, 'availability', f.availability, 'unavailable_weeks', f.unavailable_weeks,
          'practicum', f.practicum, 'police_clearance', f.police_clearance, 'parent_reach', f.parent_reach, 'parent_reach_willing', f.parent_reach_willing,
          'prior_tutoring', f.prior_tutoring, 'heard_from', f.heard_from, 'has_device', f.has_device, 'has_connection', f.has_connection, 'has_bank', f.has_bank,
          'consent_contact_at', f.consent_contact_at, 'consent_marketing_at', f.consent_marketing_at, 'consent_version', f.consent_version, 'src', f.src,
          'status', f.status,
          'effective_status', case
            when f.status = 'verified' or coalesce(tp.is_verified, false) then 'verified'
            when f.status in ('released', 'signed_up') and tp.id is not null then 'signed_up'
            when f.status in ('released', 'signed_up') then f.status
            when f.lapsed_at is not null then 'lapsed'
            else 'joined' end,
          'lapsed_at', f.lapsed_at,
          'released_at', f.released_at, 'released_messaged_at', f.released_messaged_at, 'verified_messaged_at', f.verified_messaged_at, 'waiting_messaged_at', f.waiting_messaged_at,
          'delete_after', f.delete_after, 'admin_note', f.admin_note,
          'has_account', pr.id is not null, 'tutor_verified', coalesce(tp.is_verified, false),
          'ready', rd.missing = '{}'::text[], 'missing', rd.missing,
          'weekly_hours', coalesce((select round(sum(extract(epoch from (a.end_time - a.start_time)) / 3600)::numeric, 1) from public.tutor_availability a where a.tutor_id = tp.id), 0)
        ) as j
      from public.founding_tutors_list f
      left join public.profiles pr on pr.id = coalesce(f.user_id, (select u.id from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key limit 1))
      left join public.tutor_profiles tp on tp.id = pr.id
      cross join lateral (
        select coalesce(array_agg(distinct x.phase order by x.phase), '{}'::text[]) as phases
        from jsonb_array_elements(f.subjects) el, unnest(public.founding_phases(el ->> 'min_grade', el ->> 'max_grade')) as x(phase)
      ) ph
      -- READY for the verified message: verified, an approved subject, hours saved and a current police clearance (the same tests the database uses to let a tutor accept); otherwise what is missing
      cross join lateral (
        select array_remove(array[
          case when tp.id is null then 'no tutor account yet' end,
          case when tp.id is not null and not coalesce(tp.is_verified, false) then 'not verified yet' end,
          case when tp.id is not null and not exists (select 1 from public.tutor_subject_competencies c where c.tutor_id = tp.id and c.verification_status::text = 'verified') then 'no approved subject' end,
          case when tp.id is not null and not exists (select 1 from public.tutor_availability a where a.tutor_id = tp.id) then 'no working hours saved' end,
          case when tp.id is not null and public.police_clearance_problem(tp.id) = 'police_clearance_missing' then 'no police clearance on file'
               when tp.id is not null and public.police_clearance_problem(tp.id) is not null then 'police clearance is not current' end
        ], null::text) as missing
      ) rd
      order by f.created_at desc
      limit 3000
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_entries() from public, anon;
grant execute on function public.admin_founding_entries() to authenticated;

-- The coverage view (Marketing's R7): for each subject and each grade band, who is on the list (and how many released, how many verified), the READY tutors (verified, at
-- least one approved subject for that band, and hours saved) with the hours they have set aside each week, the requests of the last 30 days (received, accepted, unserved =
-- still pending after 24 hours or more, expired), a status (OPEN: 3 or more ready tutors, THIN: 1 or 2, EMPTY: none) and a flag where there is demand but fewer than 3 ready tutors.
-- Test entries (a tag starting "test") and existing-tutor backfill rows are not counted as people on the list.
create or replace function public.admin_founding_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the coverage view' using errcode = '42501';
  end if;
  return coalesce((
    with tutors as (
      select distinct c.subject_name as subject, x.phase, c.tutor_id
      from public.tutor_subject_competencies c
      join public.tutor_profiles t on t.id = c.tutor_id and t.is_verified
      cross join lateral unnest(public.founding_phases(c.min_grade_level, c.max_grade_level)) as x(phase)
      where c.verification_status = 'verified'
        and exists (select 1 from public.tutor_availability a where a.tutor_id = c.tutor_id)
    ),
    hours as (
      select a.tutor_id, sum(extract(epoch from (a.end_time - a.start_time)) / 3600) as h
      from public.tutor_availability a group by a.tutor_id
    ),
    supply as (
      select tt.subject, tt.phase, count(*) as ready_tutors, round(coalesce(sum(h.h), 0)::numeric, 1) as weekly_hours
      from tutors tt left join hours h on h.tutor_id = tt.tutor_id
      group by tt.subject, tt.phase
    ),
    demand as (
      select e.subject_name as subject, public.founding_phase_of(e.grade_level) as phase,
        count(*) as received,
        count(*) filter (where r.status = 'accepted' or r.tutor_id is not null) as accepted,
        count(*) filter (where r.tutor_id is null and r.status = 'pending' and r.created_at < now() - interval '24 hours') as unserved,
        count(*) filter (where r.status = 'expired') as expired
      from public.session_requests r
      join public.student_subject_enrollments e on e.id = r.enrollment_id
      where r.created_at > now() - interval '30 days'
      group by e.subject_name, public.founding_phase_of(e.grade_level)
    ),
    people as (
      select f.id, f.status, f.user_id, f.email_key, f.subjects,
        (f.status = 'verified' or exists (
          select 1 from public.tutor_profiles tp
          where tp.is_verified and tp.id = coalesce(f.user_id, (select u.id from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key limit 1)))) as is_verified
      from public.founding_tutors_list f
      where f.source <> 'backfill' and coalesce(f.src, '') not like 'test%'
    ),
    entries as (
      select el ->> 'subject' as subject, x.phase,
        count(distinct p.id) as on_list,
        count(distinct p.id) filter (where p.status in ('released', 'signed_up')) as released,
        count(distinct p.id) filter (where p.is_verified) as verified
      from people p
      cross join lateral jsonb_array_elements(p.subjects) el
      cross join lateral unnest(public.founding_phases(el ->> 'min_grade', el ->> 'max_grade')) as x(phase)
      group by el ->> 'subject', x.phase
    ),
    keys as (
      select subject, phase from supply union select subject, phase from demand union select subject, phase from entries
    )
    select jsonb_agg(jsonb_build_object(
        'subject', k.subject, 'phase', k.phase,
        'on_list', coalesce(e.on_list, 0), 'released', coalesce(e.released, 0), 'verified', coalesce(e.verified, 0),
        'ready_tutors', coalesce(s.ready_tutors, 0), 'weekly_hours', coalesce(s.weekly_hours, 0),
        'requests', coalesce(d.received, 0), 'accepted', coalesce(d.accepted, 0), 'unserved_requests', coalesce(d.unserved, 0), 'expired', coalesce(d.expired, 0),
        'status', case when coalesce(s.ready_tutors, 0) >= 3 then 'OPEN' when coalesce(s.ready_tutors, 0) >= 1 then 'THIN' else 'EMPTY' end,
        'demand_no_supply', coalesce(d.received, 0) > 0 and coalesce(s.ready_tutors, 0) < 3)
      order by coalesce(d.unserved, 0) desc, coalesce(d.received, 0) desc, k.subject, k.phase)
    from keys k
    left join supply s on s.subject = k.subject and s.phase = k.phase
    left join demand d on d.subject = k.subject and d.phase = k.phase
    left join entries e on e.subject = k.subject and e.phase = k.phase
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_coverage() from public, anon;
grant execute on function public.admin_founding_coverage() to authenticated;

-- Is a tag one of the registered ones? (the registry is a JSON list in system_settings; a trailing * registers a prefix)
create or replace function public.founding_tag_registered(p_tag text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements_text(coalesce((select case when jsonb_typeof(s.setting_value) = 'array' then s.setting_value end
                                              from public.system_settings s where s.setting_key = 'founding_tag_registry'), '[]'::jsonb)) r
    where r = p_tag or (right(r, 1) = '*' and p_tag like left(r, length(r) - 1) || '%'));
$$;
revoke all on function public.founding_tag_registered(text) from public, anon, authenticated, service_role;

-- Every counted contribution of the page counters, one row per event, with the five counters as 0 or 1 (internal; the admin functions sum it).
--  * opens: every page load, under the tag the LINK carried ("(none)" when none).
--  * visitors, see_more, form_start: ONE row per visitor ever (their first of each kind), under the visitor's FIRST tag, so the days add up and nobody is counted twice.
--  * joins: every real join, under the first tag.
-- Tags starting "test" (in the link or as the first tag) are never counted.
create or replace function public.founding_count_rows()
returns table (happened timestamptz, src text, opens integer, visitors integer, see_more integer, form_start integer, joins integer)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select e.visitor_id, e.event, e.created_at,
           coalesce(nullif(e.first_src, ''), nullif(e.src, ''), '(none)') as tag,
           coalesce(nullif(e.src, ''), '(none)') as link_tag
    from public.founding_page_events e
    where coalesce(e.src, '') not like 'test%' and coalesce(e.first_src, '') not like 'test%'
  ),
  firsts as (
    select distinct on (visitor_id, event) visitor_id, event, created_at, tag
    from ev where event in ('open', 'see_more', 'form_start')
    order by visitor_id, event, created_at
  )
  select created_at, link_tag, 1, 0, 0, 0, 0 from ev where event = 'open'
  union all select created_at, tag, 0, 1, 0, 0, 0 from firsts where event = 'open'
  union all select created_at, tag, 0, 0, 1, 0, 0 from firsts where event = 'see_more'
  union all select created_at, tag, 0, 0, 0, 1, 0 from firsts where event = 'form_start'
  union all select created_at, tag, 0, 0, 0, 0, 1 from ev where event = 'join';
$$;
revoke all on function public.founding_count_rows() from public, anon, authenticated, service_role;

-- The click and funnel counts for a range of days (South African time; default the last 30 days): by day and tag, by tag, the totals, and the tags seen that are not in
-- the registry. "visitors" are NEW visitors (first seen that day), "see_more" and "form_start" are first ones: the days add up to the total.
create or replace function public.admin_founding_funnel(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Africa/Johannesburg')::date);
  v_from date;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the page counts' using errcode = '42501';
  end if;
  v_from := greatest(coalesce(p_from, v_to - 29), v_to - 365);
  if v_from > v_to then v_from := v_to; end if;
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', t.day, 'src', t.src, 'opens', t.opens, 'visitors', t.visitors, 'see_more', t.see_more, 'form_start', t.form_start, 'joins', t.joins)
                       order by t.day desc, t.src)
      from (
        select (c.happened at time zone 'Africa/Johannesburg')::date as day, c.src, sum(c.opens)::integer as opens, sum(c.visitors)::integer as visitors,
               sum(c.see_more)::integer as see_more, sum(c.form_start)::integer as form_start, sum(c.joins)::integer as joins
        from public.founding_count_rows() c
        where (c.happened at time zone 'Africa/Johannesburg')::date between v_from and v_to
        group by 1, 2
      ) t), '[]'::jsonb),
    'by_src', coalesce((
      select jsonb_agg(jsonb_build_object('src', t.src, 'opens', t.opens, 'visitors', t.visitors, 'see_more', t.see_more, 'form_start', t.form_start, 'joins', t.joins,
                                          'registered', t.src = '(none)' or public.founding_tag_registered(t.src)) order by t.opens desc, t.src)
      from (
        select c.src, sum(c.opens)::integer as opens, sum(c.visitors)::integer as visitors, sum(c.see_more)::integer as see_more,
               sum(c.form_start)::integer as form_start, sum(c.joins)::integer as joins
        from public.founding_count_rows() c
        where (c.happened at time zone 'Africa/Johannesburg')::date between v_from and v_to
        group by 1
      ) t), '[]'::jsonb),
    'totals', (
      select jsonb_build_object('opens', coalesce(sum(c.opens), 0), 'visitors', coalesce(sum(c.visitors), 0), 'see_more', coalesce(sum(c.see_more), 0),
                                'form_start', coalesce(sum(c.form_start), 0), 'joins', coalesce(sum(c.joins), 0))
      from public.founding_count_rows() c
      where (c.happened at time zone 'Africa/Johannesburg')::date between v_from and v_to),
    'unregistered', coalesce((
      select jsonb_agg(distinct c.src order by c.src)
      from public.founding_count_rows() c
      where (c.happened at time zone 'Africa/Johannesburg')::date between v_from and v_to and c.src <> '(none)' and not public.founding_tag_registered(c.src)), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_founding_funnel(date, date) from public, anon;
grant execute on function public.admin_founding_funnel(date, date) to authenticated;

-- The same five counters by HOUR (South African time) and tag for a chosen stretch (default the last 72 hours, at most 14 days): send day and the days after.
create or replace function public.admin_founding_hourly(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the page counts' using errcode = '42501';
  end if;
  v_from := greatest(coalesce(p_from, v_to - interval '72 hours'), v_to - interval '14 days');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', t.bucket, 'src', t.src, 'opens', t.opens, 'visitors', t.visitors, 'see_more', t.see_more, 'form_start', t.form_start, 'joins', t.joins)
                       order by t.bucket desc, t.src)
      from (
        select to_char(date_trunc('hour', c.happened at time zone 'Africa/Johannesburg'), 'YYYY-MM-DD HH24:00') as bucket, c.src, sum(c.opens)::integer as opens,
               sum(c.visitors)::integer as visitors, sum(c.see_more)::integer as see_more, sum(c.form_start)::integer as form_start, sum(c.joins)::integer as joins
        from public.founding_count_rows() c
        where c.happened >= v_from and c.happened < v_to
        group by 1, 2
      ) t), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_founding_hourly(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_founding_hourly(timestamptz, timestamptz) to authenticated;

-- The tag registry, edited from the admin page (a verification officer or a super admin).
create or replace function public.admin_set_founding_tags(p_tags text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[];
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can change the tag list' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct lower(btrim(t)) order by lower(btrim(t))), '{}'::text[]) into v_tags from unnest(coalesce(p_tags, '{}'::text[])) t where btrim(t) <> '';
  if array_length(v_tags, 1) > 60 or exists (select 1 from unnest(v_tags) t where t !~ '^[a-z0-9][a-z0-9-]{0,31}[*]?$') then
    raise exception 'A tag is 1 to 32 lower-case letters, digits or hyphens (a * at the end registers a prefix); at most 60 tags' using errcode = '22023';
  end if;
  insert into public.system_settings (setting_key, setting_value, description, last_updated_by, updated_at)
  values ('founding_tag_registry', to_jsonb(v_tags), 'The registered source tags for the founding tutors page (a trailing * registers a prefix).', auth.uid(), now())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, last_updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true, 'tags', to_jsonb(v_tags));
end;
$$;
revoke all on function public.admin_set_founding_tags(text[]) from public, anon;
grant execute on function public.admin_set_founding_tags(text[]) to authenticated;

-- The registry as the page shows it (so the editor starts from what is saved).
create or replace function public.admin_founding_tags()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the tag list' using errcode = '42501';
  end if;
  return coalesce((select case when jsonb_typeof(s.setting_value) = 'array' then s.setting_value end from public.system_settings s where s.setting_key = 'founding_tag_registry'), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_tags() from public, anon;
grant execute on function public.admin_founding_tags() to authenticated;

-- 9. the admin's writes --------------------------------------------------------------------------------------------------------------------------
-- Release: 'joined' -> 'released', stamps the time, and starts the 30-day delete date. Entries that are not 'joined' are left as they are (and counted as skipped).
create or replace function public.admin_release_founding(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can release places' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Choose between 1 and 500 people to release' using errcode = '22023';
  end if;
  update public.founding_tutors_list
     set status = 'released', released_at = now(), delete_after = now() + interval '30 days', lapsed_at = null, released_messaged_at = null
   where id = any (p_ids) and status = 'joined';
  get diagnostics v_n = row_count;
  return jsonb_build_object('released', v_n, 'skipped', array_length(p_ids, 1) - v_n);
end;
$$;
revoke all on function public.admin_release_founding(uuid[]) from public, anon;
grant execute on function public.admin_release_founding(uuid[]) to authenticated;

-- "Messaged": the CEO sent the ready-made WhatsApp message (the app sends nothing); this only records that he did.
create or replace function public.admin_mark_founding_messaged(p_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can do this' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('released', 'verified', 'waiting') then
    raise exception 'Choose released, verified or waiting' using errcode = '22023';
  end if;
  update public.founding_tutors_list
     set released_messaged_at = case when p_kind = 'released' then now() else released_messaged_at end,
         verified_messaged_at = case when p_kind = 'verified' then now() else verified_messaged_at end,
         waiting_messaged_at = case when p_kind = 'waiting' then now() else waiting_messaged_at end
   where id = p_id;
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_mark_founding_messaged(uuid, text) from public, anon;
grant execute on function public.admin_mark_founding_messaged(uuid, text) to authenticated;

-- A correction: set the stored status by hand (for example back to 'joined' after a mistaken release). The dates follow the status.
create or replace function public.admin_set_founding_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can do this' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('joined', 'released', 'signed_up', 'verified') then
    raise exception 'Choose joined, released, signed_up or verified' using errcode = '22023';
  end if;
  update public.founding_tutors_list
     set status = p_status,
         released_at = case when p_status = 'joined' then null else coalesce(released_at, now()) end,
         released_messaged_at = case when p_status = 'joined' then null else released_messaged_at end,
         lapsed_at = null,
         delete_after = case
           when p_status = 'joined' then created_at + interval '6 months'
           when p_status = 'released' then coalesce(released_at, now()) + interval '30 days'
           else null end
   where id = p_id;
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;
revoke all on function public.admin_set_founding_status(uuid, text) from public, anon;
grant execute on function public.admin_set_founding_status(uuid, text) to authenticated;

-- Add a person by hand (a warm tutor the CEO already knows). No form consent is recorded for them (consent_version says so).
create or replace function public.admin_add_founding_entry(p_full_name text, p_code_name text, p_whatsapp text, p_email text, p_status text default 'released')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wa text := public.tidy_za_mobile(p_whatsapp);
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_name text := btrim(coalesce(p_full_name, ''), E' \t\r\n');
  v_code text := btrim(coalesce(p_code_name, ''), E' \t\r\n');
  v_id uuid;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can add people' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 or char_length(v_code) < 1 or char_length(v_code) > 30 then
    raise exception 'Enter a full name and the name for the link' using errcode = '22023';
  end if;
  if v_wa is null then raise exception 'That is not a South African mobile number' using errcode = '22023'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('joined', 'released', 'verified') then
    raise exception 'Choose joined, released or verified' using errcode = '22023';
  end if;
  insert into public.founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, is_adult, consent_version, status, released_at, delete_after)
  values ('admin', v_name, v_code, v_wa, v_email, v_email, true, 'added-by-admin', p_status,
          case when p_status = 'joined' then null else now() end,
          case p_status when 'joined' then now() + interval '6 months' when 'released' then now() + interval '30 days' else null end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then raise exception 'That email is already on the list' using errcode = '23505'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.admin_add_founding_entry(text, text, text, text, text) from public, anon;
grant execute on function public.admin_add_founding_entry(text, text, text, text, text) to authenticated;

-- 10. the switch ---------------------------------------------------------------------------------------------------------------------------------
-- The read-back that must be clean before the gate can go on: how many tutor accounts exist, how many are covered by a list row (by account or by email), and which are not.
-- 'blocked' (informational): tutor accounts that WOULD see "wait to be verified" because their entry is only 'joined'.
create or replace function public.admin_founding_gate_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_not_listed integer;
  v_waiting integer;
  v_verified integer;
  v_released integer;
  v_names jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can read the gate check' using errcode = '42501';
  end if;
  select count(*),
         count(*) filter (where s = 'not_listed'), count(*) filter (where s = 'waiting'),
         count(*) filter (where s = 'verified'), count(*) filter (where s = 'released')
    into v_total, v_not_listed, v_waiting, v_verified, v_released
  from (select public.founding_gate_state_raw(tp.id) as s from public.tutor_profiles tp) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'name', y.full_name) order by y.full_name), '[]'::jsonb) into v_names
  from (select tp.id, pr.full_name from public.tutor_profiles tp left join public.profiles pr on pr.id = tp.id
        where public.founding_gate_state_raw(tp.id) = 'not_listed' order by pr.full_name limit 50) y;
  return jsonb_build_object(
    'gate_on', public.founding_gate_on(),
    'tutor_accounts', v_total, 'verified', v_verified, 'released', v_released, 'waiting', v_waiting, 'not_listed', v_not_listed,
    'not_listed_accounts', v_names);
end;
$$;
revoke all on function public.admin_founding_gate_check() from public, anon;
grant execute on function public.admin_founding_gate_check() to authenticated;

-- Turn the gate on or off. A super admin only. Turning it ON is refused while any tutor account has no list entry at all (the backfill read-back above must be clean).
create or replace function public.admin_set_founding_gate(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_not_listed integer;
begin
  if not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Only a super admin can switch the founding tutors gate' using errcode = '42501';
  end if;
  if p_on is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  if p_on then
    select count(*) into v_not_listed from public.tutor_profiles tp where public.founding_gate_state_raw(tp.id) = 'not_listed';
    if v_not_listed > 0 then
      raise exception '% tutor account(s) are not on the list yet. Add or release them first, then switch the gate on.', v_not_listed using errcode = '55000';
    end if;
  end if;
  insert into public.system_settings (setting_key, setting_value, description, last_updated_by, updated_at)
  values ('founding_tutors_gate', jsonb_build_object('on', p_on), 'The Teach gate for the founding tutors list.', auth.uid(), now())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, last_updated_by = auth.uid(), updated_at = now();
  begin
    perform public.log_admin_event('system_setting_updated', 'system_setting', null, jsonb_build_object('key', 'founding_tutors_gate', 'on', p_on));
  exception when others then
    null;  -- the audit line must never stop the switch
  end;
  return jsonb_build_object('ok', true, 'gate_on', p_on);
end;
$$;
revoke all on function public.admin_set_founding_gate(boolean) from public, anon;
grant execute on function public.admin_set_founding_gate(boolean) to authenticated;

-- 11. deleting what the consent text promised -----------------------------------------------------------------------------------------------------
-- Entries past their delete date go (never one whose person has an account: the Privacy Policy covers a tutor), and page counts older than 90 days go.
create or replace function public.purge_expired_founding_entries()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entries integer;
  v_events integer;
begin
  delete from public.founding_tutors_list f
   where f.source <> 'backfill' and f.status in ('joined', 'released') and f.delete_after is not null and f.delete_after < now()
     and f.user_id is null
     and not exists (select 1 from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key);
  get diagnostics v_entries = row_count;
  delete from public.founding_page_events where created_at < now() - interval '90 days';
  get diagnostics v_events = row_count;
  return jsonb_build_object('entries_deleted', v_entries, 'events_deleted', v_events);
end;
$$;
revoke all on function public.purge_expired_founding_entries() from public, anon, authenticated, service_role;

-- A released person who still has no account N days after the release message was marked as sent (default 14, setting founding_release_lapse_days) goes back to
-- "on the list" and is marked lapsed (the "place is open" message says so). A person who has an account is never lapsed. A release that was never marked as messaged
-- does not start the clock.
create or replace function public.lapse_founding_releases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_n integer;
begin
  select case when jsonb_typeof(s.setting_value) = 'number' then (s.setting_value #>> '{}')::numeric::integer end into v_days
    from public.system_settings s where s.setting_key = 'founding_release_lapse_days';
  v_days := greatest(coalesce(v_days, 14), 1);
  update public.founding_tutors_list f
     set status = 'joined', lapsed_at = now()
   where f.source <> 'backfill' and f.status = 'released' and f.released_messaged_at is not null
     and f.released_messaged_at < now() - make_interval(days => v_days)
     and f.user_id is null
     and not exists (select 1 from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.lapse_founding_releases() from public, anon, authenticated, service_role;

-- The one daily job: lapse first, then delete what is past its date.
create or replace function public.founding_daily_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lapsed integer := public.lapse_founding_releases();
  v_purged jsonb := public.purge_expired_founding_entries();
begin
  return v_purged || jsonb_build_object('lapsed', v_lapsed);
end;
$$;
revoke all on function public.founding_daily_job() from public, anon, authenticated, service_role;

-- "Remove and delete": really deletes one entry (someone replied STOP, or asked for their details to be deleted). Not for an existing tutor's account link (a backfill row).
create or replace function public.admin_delete_founding_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can delete an entry' using errcode = '42501';
  end if;
  delete from public.founding_tutors_list where id = p_id and source <> 'backfill';
  if not found then
    if exists (select 1 from public.founding_tutors_list where id = p_id) then
      raise exception 'This line is an existing tutor account, not a person who joined the list, so there is nothing to delete here' using errcode = '55000';
    end if;
    raise exception 'No such entry' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_delete_founding_entry(uuid) from public, anon;
grant execute on function public.admin_delete_founding_entry(uuid) to authenticated;

-- Link an entry to the tutor's account the moment the tutor profile is made (by the sign-up email), so the code system and the admin page can read it by account.
-- This trigger can NEVER stop a sign-up: any problem is swallowed.
create or replace function public.founding_link_on_tutor_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.founding_tutors_list f
       set user_id = new.id
     where f.user_id is null and f.source <> 'backfill'
       and f.email_key = (select lower(btrim(u.email)) from auth.users u where u.id = new.id)
       and not exists (select 1 from public.founding_tutors_list g where g.user_id = new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.founding_link_on_tutor_profile() from public, anon, authenticated, service_role;

drop trigger if exists founding_link_on_tutor_profile on public.tutor_profiles;
create trigger founding_link_on_tutor_profile after insert on public.tutor_profiles
  for each row execute function public.founding_link_on_tutor_profile();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-founding-list') where exists (select 1 from cron.job where jobname = 'purge-founding-list');
    perform cron.schedule('purge-founding-list', '20 3 * * *', 'select public.founding_daily_job();');
  end if;
end $$;

-- 12. the backfill: nobody who is a tutor today is locked out --------------------------------------------------------------------------------------
-- One list row per tutor profile that exists now, linked by account (user_id), with no personal details copied. A verified tutor is 'verified'; any other is
-- 'released' (so a tutor part-way through the documents can carry on). Safe to run again: a tutor that already has a row is skipped.
insert into public.founding_tutors_list (source, status, user_id, consent_version, delete_after)
select 'backfill', case when coalesce(tp.is_verified, false) then 'verified' else 'released' end, tp.id, 'backfill-2026-11-10', null
from public.tutor_profiles tp
where not exists (select 1 from public.founding_tutors_list f where f.user_id = tp.id)
on conflict do nothing;

-- 13. 11 Nov additions (the PM's list after Programmer C's report) ------------------------------------------------------------------------------------
-- 13a. REFUSE TO CREATE A TUTOR PROFILE for a person whose place has not opened. There are three database paths that make a tutor_profiles row (the sign-up trigger,
-- convert_new_account_role('tutor') for the Google path, and the "Tutors insert own profile" policy); one BEFORE INSERT trigger on the table covers all three. While the
-- switch is OFF it passes at once. When ON, a person who is not on the list, or is on it but not released, cannot get a tutor profile: sign-up as a tutor, the Google switch
-- and a direct insert all fail with the plain sentence. The owner running SQL (a migration, the SQL editor, the backfill) is not held to it; the sign-up service and every
-- API call are. (founding.test_enforce = 'on' makes the rule apply to the owner too: only the rolled-back suite sets it, and it can only make the rule stricter.)
create or replace function public.founding_gate_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('founding.test_enforce', true), '') <> 'on' then
    return new;
  end if;
  if not public.founding_gate_on() then return new; end if;
  if public.founding_gate_state_raw(new.id) in ('not_listed', 'waiting') then
    raise exception 'Tutoring places open in groups. Join the founding tutors list and we will message you when your place opens.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.founding_gate_profile_guard() from public, anon, authenticated, service_role;
drop trigger if exists founding_gate_profile_guard on public.tutor_profiles;
create trigger founding_gate_profile_guard before insert on public.tutor_profiles
  for each row execute function public.founding_gate_profile_guard();

-- 13b. VIDEO ROOMS: while the switch is ON only a VERIFIED tutor can open a room (Programmer C found no verification check in the room code: an unapproved tutor could open a
-- room and share its link). A session's room is opened for a booked session, whose tutor is verified, so it is unaffected. The same trigger holds the tutor back at any state
-- before verified. With the switch off nothing changes.
create or replace function public.founding_gate_room_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_gate_on() then return new; end if;
  if public.founding_gate_state_raw(new.host_id) <> 'verified' then
    raise exception 'You can open video rooms once you are verified.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.founding_gate_room_guard() from public, anon, authenticated, service_role;
do $$
begin
  if to_regclass('public.video_rooms') is not null then
    execute 'drop trigger if exists founding_gate_room_guard on public.video_rooms';
    execute 'create trigger founding_gate_room_guard before insert on public.video_rooms for each row execute function public.founding_gate_room_guard()';
  end if;
end $$;

-- 13c. tutor_onboarding.completed_at: stamped the FIRST time the "finished" rule is met (Marketing's T8): the person agreed, chose a type, and has an identity document, a
-- police certificate issued in the last 6 months (South African date), and school results (beginner) or proof of experience (experienced); no counted document is rejected.
-- It is the same rule the screens use (src/lib/tutorOnboarding.ts isOnboardingComplete). Never un-stamped. The triggers can never stop an upload or a consent.
alter table public.tutor_onboarding add column if not exists completed_at timestamptz;

create or replace function public.tutor_onboarding_finished(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select o.track is not null and o.consented_at is not null
      and exists (select 1 from public.tutor_verification_documents d
                  where d.tutor_id = p_tutor and d.document_type::text = 'identity_doc' and d.status::text is distinct from 'rejected')
      and exists (select 1 from public.tutor_verification_documents d
                  where d.tutor_id = p_tutor and d.document_type::text = 'police_clearance' and d.status::text is distinct from 'rejected'
                    and d.issued_on is not null
                    and d.issued_on <= (now() at time zone 'Africa/Johannesburg')::date
                    and d.issued_on >= ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date)
      and exists (select 1 from public.tutor_verification_documents d
                  where d.tutor_id = p_tutor and d.status::text is distinct from 'rejected'
                    and d.document_type::text = case o.track when 'beginner' then 'subject_results' else 'proof_of_experience' end)
    from public.tutor_onboarding o where o.tutor_id = p_tutor), false);
$$;
revoke all on function public.tutor_onboarding_finished(uuid) from public, anon, authenticated, service_role;

create or replace function public.tutor_onboarding_stamp_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if public.tutor_onboarding_finished(new.tutor_id) then
      update public.tutor_onboarding set completed_at = now() where tutor_id = new.tutor_id and completed_at is null;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.tutor_onboarding_stamp_completed() from public, anon, authenticated, service_role;
drop trigger if exists tutor_onboarding_stamp_on_document on public.tutor_verification_documents;
create trigger tutor_onboarding_stamp_on_document after insert or update on public.tutor_verification_documents
  for each row execute function public.tutor_onboarding_stamp_completed();
drop trigger if exists tutor_onboarding_stamp_on_consent on public.tutor_onboarding;
create trigger tutor_onboarding_stamp_on_consent after insert or update of track, consented_at on public.tutor_onboarding
  for each row execute function public.tutor_onboarding_stamp_completed();

-- Tutors who already meet the rule today get a stamp (the later of their agreement and their newest document).
update public.tutor_onboarding o
   set completed_at = greatest(o.consented_at, coalesce((select max(d.uploaded_at) from public.tutor_verification_documents d where d.tutor_id = o.tutor_id), o.consented_at))
 where o.completed_at is null and public.tutor_onboarding_finished(o.tutor_id);

-- 13d. tutor_profiles.first_request_seen_at: set ONCE, by the tutor's own Teach screen, the first time its request list returns a row (Marketing's T11; nothing records an
-- "offer" because tutors pull the list). A person cannot write it directly. tutor_profiles has no table-wide read right for API roles, so the new column is not readable
-- by them either; the admin reads it through functions.
alter table public.tutor_profiles add column if not exists first_request_seen_at timestamptz;

create or replace function public.tutor_first_seen_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.first_request_seen_at := old.first_request_seen_at;
  end if;
  return new;
end;
$$;
revoke all on function public.tutor_first_seen_guard() from public, anon, authenticated, service_role;
drop trigger if exists tutor_first_seen_guard on public.tutor_profiles;
create trigger tutor_first_seen_guard before update of first_request_seen_at on public.tutor_profiles
  for each row execute function public.tutor_first_seen_guard();

create or replace function public.note_first_request_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.tutor_profiles set first_request_seen_at = now() where id = auth.uid() and first_request_seen_at is null;
end;
$$;
revoke all on function public.note_first_request_seen() from public, anon;
grant execute on function public.note_first_request_seen() to authenticated;

-- 14. 11 Nov additions, second round (the PM's decisions) ---------------------------------------------------------------------------------------------------
-- 14a. Is the switch on? Open to signed-out visitors too (the switch is not secret): the public start page and the sign-in page send "Become a tutor" to the list page while it is on.
create or replace function public.founding_gate_public()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.founding_gate_on();
$$;
revoke all on function public.founding_gate_public() from public;
grant execute on function public.founding_gate_public() to anon, authenticated;

-- 14b. "Link this account": when someone signs up with a different email from the one they gave the list, an admin links the entry to their tutor account by typing the sign-up
-- email. Only an entry that has no account yet (never an existing tutor's backfill line), only an account that is a tutor account, and one entry per account.
create or replace function public.admin_link_founding_entry(p_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_uid uuid;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can link an account' using errcode = '42501';
  end if;
  select u.id into v_uid from auth.users u where lower(btrim(u.email)) = v_email limit 1;
  if v_uid is null then
    raise exception 'There is no account with that email yet' using errcode = '55000';
  end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = v_uid) then
    raise exception 'That account is not a tutor account' using errcode = '55000';
  end if;
  update public.founding_tutors_list set user_id = v_uid where id = p_id and source <> 'backfill' and user_id is null;
  if not found then
    raise exception 'That entry cannot be linked (it does not exist, it already has an account, or it is an existing tutor''s line)' using errcode = '55000';
  end if;
  return jsonb_build_object('ok', true);
exception when unique_violation then
  raise exception 'That account is already linked to another entry' using errcode = '23505';
end;
$$;
revoke all on function public.admin_link_founding_entry(uuid, text) from public, anon;
grant execute on function public.admin_link_founding_entry(uuid, text) to authenticated;
