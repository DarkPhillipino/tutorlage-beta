-- Close-account tool (CEO: "build it", 21 Oct 2026; rules: Drake/legal/handover-and-closing-rules-2026-10-21.md Part B; design: Drake/programmer/close-account-design-2026-10-21.md).
-- Privacy §14 promises "account details deleted within 90 days of closing"; until now no code did it. This adds:
--   * request_account_closure(): the signed-in person (typed CLOSE + a sign-in within the last 10 minutes), a guardian for one learner under 18 or
--     for the whole household. Closing signs the person out at once (banned in Auth, sessions removed), cancels and refunds upcoming sessions
--     and open requests, takes a tutor off dispatch and queues a confirmation email. It is refused only for a session in progress or starting
--     within 30 minutes, or an open video room ("Try again after your session"). A safety hold NEVER blocks it, and the reply is identical.
--   * admin_close_account(): an admin, on a written request (who asked, when, how verified, reference) or under Terms §17.2; undo_account_closure()
--     (admin only, within 30 days, if the person asks); defer_account_closure() (admin: debt, bank dispute, legal matter);
--     list_account_closures() and read_account_tombstone() (super admins only).
--   * run_account_closures(): the daily job. On day 30 it deletes or blanks what legal's B3 lists, keeps (pseudonymised) what must stay, writes
--     the tombstone and an insert-only deletion record, and queues the outside-the-database steps (Storage files, Paystack, email, Auth user)
--     for the Worker. It does NOTHING for a person on a safety hold, a deferred closure or an open dispute. Day 90 is the outer limit (an admin
--     is alerted if something is still open). The profile row is never deleted: its personal fields are blanked in place.
--   * close_account_claim_tasks() / close_account_task_result(): the Worker (server key only) takes queued tasks and reports each one.
-- Browsers have no right on any new table; every function is a definer with a pinned search path. Additive: no existing table, policy or
-- function is changed (three setting rows are added). The companion migration 20261021141000 makes deleting the Auth user keep the profile row.

insert into public.system_settings (setting_key, setting_value, description) values
  ('account_closure_days_to_delete', '30'::jsonb, 'Days after closing before the daily job deletes the person''s data (also the undo window).'),
  ('account_closure_days_outer_limit', '90'::jsonb, 'Days after closing by which everything not held back must be deleted (Privacy §14); an admin is alerted if not.'),
  ('account_closure_worker_url', '""'::jsonb, 'Address of the Worker (no trailing path) that the closure job wakes with pg_net; empty = it is not woken.')
on conflict (setting_key) do nothing;

-- One row per closure: the state of it. No API role can read or write it.
create table if not exists public.account_closures (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  role text not null,
  status text not null default 'closed' check (status in ('closed', 'undone', 'db_deleted', 'done')),
  started_by uuid not null,
  started_how text not null check (started_how in ('self', 'guardian', 'admin_request', 'admin_terms')),
  household_of uuid,
  asked_by text, asked_on timestamptz, how_verified text, reference text, note text,
  contact_email text,
  was_adult boolean not null,
  was_dispatch_active boolean,
  closed_at timestamptz not null default now(),
  due_at timestamptz not null,
  outer_limit_at timestamptz not null,
  undo_until timestamptz not null,
  deferred_until timestamptz, deferred_reason text, deferred_by uuid,
  undone_at timestamptz, undone_by uuid, undone_note text,
  sessions_cancelled integer not null default 0,
  cards_kept boolean not null default false,
  payout_kept boolean not null default false,
  db_deleted_at timestamptz, done_at timestamptz, overdue_alerted_at timestamptz,
  last_error text, last_error_at timestamptz
);
create unique index if not exists account_closures_one_live_idx on public.account_closures (profile_id) where status in ('closed', 'db_deleted');
create index if not exists account_closures_due_idx on public.account_closures (status, due_at);
alter table public.account_closures enable row level security;
revoke all on public.account_closures from public, anon, authenticated, service_role;

-- The tombstone: the only place a closed ADULT's name is kept (a learner under 18 is never named). Locked.
create table if not exists public.account_tombstones (
  profile_id uuid primary key,
  closure_id uuid not null,
  role text not null,
  display_name text,
  closed_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.account_tombstones enable row level security;
revoke all on public.account_tombstones from public, anon, authenticated, service_role;

-- The deletion record: one insert-only row per closure (who started it, when, what was deleted, what was kept and why, what is outside).
create table if not exists public.account_deletion_records (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null unique,
  profile_id uuid not null,
  role text not null,
  started_by uuid not null,
  started_how text not null,
  closed_at timestamptz not null,
  deleted_at timestamptz not null default now(),
  deleted jsonb not null,
  kept jsonb not null,
  outside jsonb not null
);
alter table public.account_deletion_records enable row level security;
revoke all on public.account_deletion_records from public, anon, authenticated, service_role;

create or replace function public.account_deletion_records_are_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Deletion records can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.account_deletion_records_are_append_only() from public, anon, authenticated, service_role;
drop trigger if exists account_deletion_records_no_change on public.account_deletion_records;
create trigger account_deletion_records_no_change before update or delete on public.account_deletion_records
  for each row execute function public.account_deletion_records_are_append_only();
drop trigger if exists account_deletion_records_no_truncate on public.account_deletion_records;
create trigger account_deletion_records_no_truncate before truncate on public.account_deletion_records
  for each statement execute function public.account_deletion_records_are_append_only();

-- The steps outside the database, queued for the Worker.
create table if not exists public.account_closure_tasks (
  id bigint generated always as identity primary key,
  closure_id uuid not null,
  profile_id uuid not null,
  kind text not null check (kind in ('email', 'paystack_cards', 'paystack_subaccount', 'storage_remove', 'auth_delete')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'gave_up')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);
create index if not exists account_closure_tasks_open_idx on public.account_closure_tasks (status, id);
create index if not exists account_closure_tasks_closure_idx on public.account_closure_tasks (closure_id);
alter table public.account_closure_tasks enable row level security;
revoke all on public.account_closure_tasks from public, anon, authenticated, service_role;

-- Small internal helpers (not callable through the API) -----------------------------------------------------------------------------

create or replace function public.closure_int_setting(p_key text, p_default integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v integer;
begin
  select nullif(s.setting_value #>> '{}', '')::integer into v from public.system_settings s where s.setting_key = p_key;
  return case when v is null or v < 1 then p_default else v end;
exception when others then
  return p_default;
end;
$$;

create or replace function public.closure_is_adult(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.date_of_birth <= (current_date - interval '18 years')::date from public.profiles p where p.id = p_profile), false);
$$;

create or replace function public.closure_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin');
$$;

create or replace function public.closure_busy(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where (s.student_id = p_profile or s.tutor_id = p_profile or s.booked_by_profile_id = p_profile)
      and (s.status = 'in_progress'
           or (s.status = 'scheduled' and s.scheduled_start - interval '30 minutes' <= now()
               and s.scheduled_start + make_interval(secs => (s.duration_hours * 3600)::double precision) > now())))
  or exists (
    select 1 from public.video_rooms r
    where r.ended_at is null and r.expires_at > now()
      and (r.host_id = p_profile
           or exists (select 1 from public.video_room_members m where m.room_id = r.id and m.profile_id = p_profile and m.status in ('waiting', 'admitted'))));
$$;

create or replace function public.closure_has_open_dispute(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_disputes d
    where d.status in ('open', 'under_investigation')
      and (d.raised_by_id = p_profile
           or exists (select 1 from public.sessions s
                      where s.id = d.session_id and (s.tutor_id = p_profile or s.student_id = p_profile or s.booked_by_profile_id = p_profile))));
$$;

create or replace function public.closure_enqueue(p_closure uuid, p_profile uuid, p_kind text, p_payload jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.account_closure_tasks (closure_id, profile_id, kind, payload) values (p_closure, p_profile, p_kind, coalesce(p_payload, '{}'::jsonb));
$$;

-- The same lines for everyone (a held person must not be able to tell from the reply).
create or replace function public.closure_text()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'deleted', jsonb_build_array('your name, email, phone number and picture', 'your sign-in', 'saved cards', 'messages and notifications',
                                 'a learner''s school, grade and school results', 'a tutor''s profile, availability, subjects and bio',
                                 'free-text review comments'),
    'kept', jsonb_build_array(
      jsonb_build_object('what', 'Bookings, payments and refunds, without your name', 'how_long', '7 years after the end of the financial year'),
      jsonb_build_object('what', 'Records of what you agreed to (terms, consents)', 'how_long', '5 years after the account closes'),
      jsonb_build_object('what', 'A tutor''s ID copy, police clearance and verification documents', 'how_long', '3 years after they stop tutoring or close'),
      jsonb_build_object('what', 'Problem reports and safety reports', 'how_long', '5 years, longer if a matter is open'),
      jsonb_build_object('what', 'Anything the law or an open matter requires us to keep', 'how_long', 'as long as that requires')),
    'note', 'We must keep some records for longer, because the law or an open matter requires it. Privacy Policy §14 says which.');
$$;

-- Who a closure covers. A person closes themselves; a guardian also closes every learner under 18 linked to them; a guardian may
-- close one linked learner under 18; a learner under 18 cannot close alone; nobody closes another adult.
create or replace function public.closure_household(p_profile uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = p_profile;
  if v_role is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    raise exception 'Admin accounts are closed another way';
  end if;
  return array[p_profile] || case when v_role = 'parent' then coalesce((
      select array_agg(l.student_id order by l.student_id) from public.parent_student_links l
      where l.parent_id = p_profile and not public.closure_is_adult(l.student_id)
        and not exists (select 1 from public.account_closures c where c.profile_id = l.student_id and c.status in ('closed', 'db_deleted', 'done'))
    ), '{}'::uuid[]) else '{}'::uuid[] end;
end;
$$;

create or replace function public.closure_targets(p_caller uuid, p_learner uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = p_caller;
  if v_role is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    raise exception 'Admin accounts are closed another way';
  end if;
  if p_learner is not null and p_learner <> p_caller then
    if v_role <> 'parent' or public.closure_is_adult(p_learner)
       or not exists (select 1 from public.parent_student_links l where l.parent_id = p_caller and l.student_id = p_learner) then
      raise exception 'You can only close a learner under 18 who is linked to your account';
    end if;
    if exists (select 1 from public.account_closures c where c.profile_id = p_learner and c.status in ('closed', 'db_deleted', 'done')) then
      raise exception 'This account is already closed';
    end if;
    return array[p_learner];
  end if;
  if v_role = 'student' and not public.closure_is_adult(p_caller) then
    raise exception 'A learner under 18 can''t close their own account. Ask your parent or guardian.';
  end if;
  return public.closure_household(p_caller);
end;
$$;

-- Refund through the existing machinery: the same Paystack call and the same statuses as cancel_session(), so the refund jobs,
-- webhook and notices handle it as they handle any refund. (cancel_session() itself reads auth.uid() and enforces the learner's
-- cancellation window, so it cannot be used for a closure: the person is leaving.)
create or replace function public.closure_refund(p_request uuid, p_new_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req record;
  v_secret text;
  v_net bigint;
begin
  select * into v_req from public.session_requests where id = p_request for update;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    raise exception 'Refunds aren''t set up on this server yet — contact support';
  end if;
  select net.http_post(
    url := 'https://api.paystack.co/refund',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('transaction', coalesce(v_req.charge_reference, v_req.paystack_reference))
  ) into v_net;
  update public.session_requests
  set status = p_new_status, payment_status = 'refund_pending', refund_request_id = v_net, refund_requested_at = now()
  where id = p_request;
end;
$$;

create or replace function public.closure_cancel_session(p_session uuid, p_by_tutor boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_s record;
  v_r record;
  v_out text;
begin
  select id, student_id, tutor_id, status, scheduled_start, booked_by_profile_id into v_s from public.sessions where id = p_session for update;
  if not found or v_s.status not in ('scheduled', 'pending_confirmation') or now() >= v_s.scheduled_start then
    return 'skipped';
  end if;
  select * into v_r from public.session_requests where resulting_session_id = p_session for update;
  if found and v_r.payment_status = 'paid' then
    perform public.closure_refund(v_r.id, 'cancelled');
    v_out := 'refunded';
  else
    if found then
      update public.session_requests set status = 'cancelled' where id = v_r.id and status <> 'cancelled';
    end if;
    perform public.notify_active_admins('closure_session_unpaid', 'A closed account had a session with nothing to refund',
      'Session ' || p_session || ' was cancelled by an account closure but no paid request was found for it. Please check it.', p_session);
    v_out := 'cancelled';
  end if;
  update public.sessions
  set status = case when p_by_tutor then 'cancelled_by_tutor'::public.session_status else 'cancelled_by_student'::public.session_status end
  where id = p_session;
  if p_by_tutor then
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    select distinct p, 'session_cancelled', 'A session was cancelled',
           'Your tutor cancelled the session.' || case when v_out = 'refunded'
             then ' Your payment is being refunded in full — once Paystack has processed it, it can take up to 10 business days to reach your account.' else '' end,
           p_session
    from unnest(array[v_s.student_id, v_s.booked_by_profile_id]) as p where p is not null;
  else
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    values (v_s.tutor_id, 'session_cancelled', 'A session was cancelled', 'The learner cancelled the session.', p_session);
  end if;
  return v_out;
end;
$$;

-- Starts one closure (one person). Called by request_account_closure() and admin_close_account().
create or replace function public.closure_start(
  p_profile uuid, p_started_by uuid, p_how text, p_household_of uuid,
  p_asked_by text, p_asked_on timestamptz, p_how_verified text, p_reference text, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_p public.profiles;
  v_id uuid := gen_random_uuid();
  v_days integer := public.closure_int_setting('account_closure_days_to_delete', 30);
  v_outer integer := public.closure_int_setting('account_closure_days_outer_limit', 90);
  v_adult boolean;
  v_dispatch boolean;
  v_contact text;
  v_s record;
  v_r record;
  n_s integer := 0;
  n_r integer := 0;
  v_owed numeric := 0;
  v_held boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || p_profile::text, 0));
  select * into v_p from public.profiles where id = p_profile;
  if not found then
    raise exception 'No such account' using errcode = 'P0002';
  end if;
  if v_p.role = 'admin' then
    raise exception 'Admin accounts are closed another way';
  end if;
  if exists (select 1 from public.account_closures c where c.profile_id = p_profile and c.status in ('closed', 'db_deleted', 'done')) then
    raise exception 'This account is already closed';
  end if;
  if public.closure_busy(p_profile) then
    raise exception 'Try again after your session';
  end if;
  v_held := public.profile_is_on_safety_hold(p_profile);
  v_adult := v_p.role <> 'student' or public.closure_is_adult(p_profile);
  v_contact := case when p_how = 'guardian' then (select s.email from public.profiles s where s.id = p_started_by) else v_p.email end;
  -- A learner a guardian added signs in with a made-up name under learners.tutorlage.invalid, which can never receive mail: no address.
  if v_contact is null or v_contact ~* '@learners\.tutorlage\.invalid$' then
    v_contact := null;
  end if;
  if v_p.role = 'tutor' then
    select t.is_dispatch_active into v_dispatch from public.tutor_profiles t where t.id = p_profile;
  end if;

  insert into public.account_closures (id, profile_id, role, started_by, started_how, household_of, asked_by, asked_on, how_verified, reference, note,
                                       contact_email, was_adult, was_dispatch_active, due_at, outer_limit_at, undo_until)
  values (v_id, p_profile, v_p.role::text, p_started_by, p_how, p_household_of, p_asked_by, p_asked_on, p_how_verified, p_reference, p_note,
          v_contact, v_adult, v_dispatch, now() + make_interval(days => v_days), now() + make_interval(days => v_outer), now() + make_interval(days => v_days));

  -- Upcoming sessions: cancelled and refunded in full (a tutor closing: their learners are refunded and told).
  for v_s in
    select s.id, (s.tutor_id = p_profile) as by_tutor from public.sessions s
    where s.status in ('scheduled', 'pending_confirmation') and s.scheduled_start > now()
      and (s.tutor_id = p_profile or s.student_id = p_profile or s.booked_by_profile_id = p_profile)
    order by s.scheduled_start for update
  loop
    if public.closure_cancel_session(v_s.id, v_s.by_tutor) <> 'skipped' then
      n_s := n_s + 1;
    end if;
  end loop;
  -- Requests nobody has accepted yet: withdrawn, so no tutor can accept one after the person has gone.
  for v_r in
    select r.id, r.payment_status, (r.requested_tutor_id = p_profile and r.student_id <> p_profile and r.requested_by_profile_id <> p_profile) as addressed_to_me
    from public.session_requests r
    where r.status = 'pending' and (r.student_id = p_profile or r.requested_by_profile_id = p_profile or r.requested_tutor_id = p_profile)
    for update
  loop
    if v_r.payment_status = 'paid' then
      perform public.closure_refund(v_r.id, case when v_r.addressed_to_me then 'expired' else 'cancelled' end);
    else
      update public.session_requests set status = case when v_r.addressed_to_me then 'expired' else 'cancelled' end where id = v_r.id;
    end if;
    n_r := n_r + 1;
  end loop;
  update public.account_closures set sessions_cancelled = n_s where id = v_id;

  -- Out at once: no sign-in, no refresh, no dispatch. (A signed-in screen may keep working until its access token expires.)
  update auth.users set banned_until = now() + interval '100 years' where id = p_profile;
  delete from auth.sessions where user_id = p_profile;
  if v_p.role = 'tutor' then
    update public.tutor_profiles set is_dispatch_active = false where id = p_profile;
    v_owed := coalesce((select sum(po.total_amount) from public.payouts po where po.tutor_id = p_profile and po.status in ('pending', 'processing')), 0)
            + coalesce((select sum(s.tutor_payout_amount) from public.sessions s where s.tutor_id = p_profile and s.status = 'completed' and s.completed_at > now() - interval '7 days'), 0);
    if v_owed > 0 then
      perform public.notify_active_admins('closure_payout_owed', 'A tutor who is owed money has closed their account',
        'Closure ' || v_id || ': the tutor may be owed about ' || v_owed || '. Their bank details are kept until it is paid.');
    end if;
  end if;

  if v_contact is not null then
    perform public.closure_enqueue(v_id, p_profile, 'email', jsonb_build_object(
      'to', v_contact, 'template', 'closed',
      'subject', 'Your Tutorlage account has been closed',
      'text', format(E'Your Tutorlage account was closed on %s.\n\nUpcoming sessions were cancelled and refunded in full. We delete your account details within %s days, and always within %s days of closing. %s\n\nIf you closed it by mistake, write to support@tutorlage.com by %s and we can reopen it.\n\nTutorlage',
        to_char(now(), 'FMDD FMMonth YYYY'), v_days, v_outer, public.closure_text() ->> 'note', to_char(now() + make_interval(days => v_days), 'FMDD FMMonth YYYY'))));
  end if;
  if v_held then
    perform public.notify_active_admins('closure_of_held_person', 'A person on a safety hold has closed their account',
      'The account of ' || coalesce(nullif(v_p.full_name, ''), 'a person') || ' (' || p_profile || ') was closed (closure ' || v_id
      || '). Nothing about them will be deleted or anonymised while the hold stands.');
  end if;
  return jsonb_build_object('closure_id', v_id, 'profile_id', p_profile, 'sessions_cancelled', n_s, 'requests_withdrawn', n_r);
end;
$$;

-- Runs a set of closures (the person and, for a guardian, the household) in one go.
create or replace function public.closure_run(
  p_ids uuid[], p_started_by uuid, p_how text,
  p_asked_by text, p_asked_on timestamptz, p_how_verified text, p_reference text, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  i integer;
  v_one jsonb;
  v_root uuid;
  v_all jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_due timestamptz;
  v_outer timestamptz;
  v_undo timestamptz;
  v_how text;
begin
  for i in 1 .. array_length(p_ids, 1) loop
    if public.closure_busy(p_ids[i]) then
      raise exception 'Try again after your session';
    end if;
  end loop;
  for i in 1 .. array_length(p_ids, 1) loop
    v_how := case when i = 1 or p_how in ('admin_request', 'admin_terms') then p_how else 'guardian' end;
    v_one := public.closure_start(p_ids[i], p_started_by, v_how, case when i = 1 then null else v_root end, p_asked_by, p_asked_on, p_how_verified, p_reference, p_note);
    if i = 1 then
      v_root := (v_one ->> 'closure_id')::uuid;
    end if;
    v_all := v_all || jsonb_build_array(v_one ->> 'closure_id');
    v_n := v_n + (v_one ->> 'sessions_cancelled')::integer;
  end loop;
  select c.due_at, c.outer_limit_at, c.undo_until into v_due, v_outer, v_undo from public.account_closures c where c.id = v_root;
  perform public.closure_wake_worker();
  return jsonb_build_object('closure_ids', v_all, 'accounts_closed', array_length(p_ids, 1), 'sessions_cancelled', v_n,
    'delete_after', v_due, 'delete_by', v_outer, 'undo_until', v_undo, 'note', public.closure_text() ->> 'note');
end;
$$;

create or replace function public.closure_wake_worker()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.setting_value #>> '{}' into v_url from public.system_settings s where s.setting_key = 'account_closure_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'account_closure_job_secret';
  if coalesce(v_url, '') = '' or v_secret is null then
    raise notice 'account_closure_worker_url or the account_closure_job_secret vault secret is not set; the Worker is not woken';
    return;
  end if;
  if not exists (select 1 from public.account_closure_tasks t where t.status in ('pending', 'claimed')) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/close-account/run',
    headers := jsonb_build_object('x-job-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

-- What a Auth-user delete may safely do: only true once migration 20261021141000 is in (profiles no longer cascades from Auth).
create or replace function public.closure_auth_link_is_safe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype = 'c')
     and exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                 where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and p.proname = 'keep_closed_profile_after_auth_delete');
$$;

-- Callable by signed-in people ------------------------------------------------------------------------------------------------------

create or replace function public.preview_account_closure(p_learner uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_accounts jsonb := '[]'::jsonb;
  v_blocked boolean := false;
  v_owed numeric;
  v_p public.profiles;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_ids := public.closure_targets(v_uid, p_learner);
  foreach v_id in array v_ids loop
    select * into v_p from public.profiles where id = v_id;
    if public.closure_busy(v_id) then
      v_blocked := true;
    end if;
    v_owed := case when v_p.role = 'tutor' then
        coalesce((select sum(po.total_amount) from public.payouts po where po.tutor_id = v_id and po.status in ('pending', 'processing')), 0)
        + coalesce((select sum(s.tutor_payout_amount) from public.sessions s where s.tutor_id = v_id and s.status = 'completed' and s.completed_at > now() - interval '7 days'), 0)
      else 0 end;
    v_accounts := v_accounts || jsonb_build_array(jsonb_build_object(
      'profile_id', v_id,
      'name', v_p.full_name,
      'role', v_p.role,
      'sessions_to_cancel', coalesce((
        select jsonb_agg(jsonb_build_object('session_id', s.id, 'scheduled_start', s.scheduled_start, 'duration_hours', s.duration_hours,
                                            'amount', s.gross_amount, 'currency', s.currency_code) order by s.scheduled_start)
        from public.sessions s
        where s.status in ('scheduled', 'pending_confirmation') and s.scheduled_start > now()
          and (s.tutor_id = v_id or s.student_id = v_id or s.booked_by_profile_id = v_id)), '[]'::jsonb),
      'payout_owed', case when v_owed > 0 then v_owed else null end));
  end loop;
  return jsonb_build_object(
    'accounts', v_accounts,
    'blocked', v_blocked,
    'blocked_message', case when v_blocked then 'Try again after your session' else null end,
    'delete_after_days', public.closure_int_setting('account_closure_days_to_delete', 30),
    'delete_by_days', public.closure_int_setting('account_closure_days_outer_limit', 90),
    'undo_days', public.closure_int_setting('account_closure_days_to_delete', 30),
    'deleted', public.closure_text() -> 'deleted',
    'kept', public.closure_text() -> 'kept',
    'note', public.closure_text() ->> 'note');
end;
$$;

create or replace function public.request_account_closure(p_confirmation text, p_learner uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_confirmation, ''))) <> 'CLOSE' then
    raise exception 'Type CLOSE to confirm';
  end if;
  -- The app asks for the password again just before this call; that gives a fresh access token, so the token's issue time is the proof.
  if coalesce((auth.jwt() ->> 'iat')::numeric, 0) < extract(epoch from now()) - 600 then
    raise exception 'Please sign in again to confirm this';
  end if;
  v_ids := public.closure_targets(v_uid, p_learner);
  return public.closure_run(v_ids, v_uid, case when p_learner is not null and p_learner <> v_uid then 'guardian' else 'self' end,
                            null, null, null, null, null);
end;
$$;

-- Admins ----------------------------------------------------------------------------------------------------------------------------

create or replace function public.admin_close_account(
  p_profile uuid, p_basis text, p_requested_by text, p_requested_on timestamptz, p_how_verified text, p_reference text, p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('person_request', 'terms_17_2') then
    raise exception 'Say why: person_request or terms_17_2' using errcode = '22023';
  end if;
  if p_basis = 'person_request' then
    if length(btrim(coalesce(p_requested_by, ''))) < 3 or length(btrim(coalesce(p_how_verified, ''))) < 3 or length(btrim(coalesce(p_reference, ''))) < 3 then
      raise exception 'Write down who asked, how you checked it was them, and the reference of the request' using errcode = '22023';
    end if;
    if p_requested_on is null or p_requested_on > now() then
      raise exception 'Say when they asked' using errcode = '22023';
    end if;
    if public.profile_is_on_safety_hold(p_profile) and not public.closure_is_super_admin() then
      raise exception 'This person is on a safety hold: only the safeguarding lead can close it on a request' using errcode = '42501';
    end if;
  elsif length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Write down why the account is being closed' using errcode = '22023';
  end if;
  return public.closure_run(public.closure_household(p_profile), v_admin, case when p_basis = 'person_request' then 'admin_request' else 'admin_terms' end,
                            btrim(coalesce(p_requested_by, 'Tutorlage')), p_requested_on, btrim(p_how_verified), btrim(p_reference), btrim(p_note));
end;
$$;

create or replace function public.undo_account_closure(p_closure uuid, p_asked_by text, p_how_verified text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  c public.account_closures;
  r record;
  v_n integer := 0;
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_asked_by, ''))) < 3 or length(btrim(coalesce(p_how_verified, ''))) < 3 or length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Write down who asked, how you checked it was them, and a short note' using errcode = '22023';
  end if;
  select * into c from public.account_closures where id = p_closure for update;
  if not found then
    raise exception 'No such closure' using errcode = 'P0002';
  end if;
  for r in
    select x.* from public.account_closures x
    where x.id = p_closure or (x.household_of = p_closure and x.status = 'closed')
    order by (x.id <> p_closure) for update
  loop
    if r.status <> 'closed' or now() >= r.undo_until then
      raise exception 'This closure can no longer be undone (deletion has started, or the time is up)';
    end if;
    update auth.users set banned_until = null where id = r.profile_id;
    if r.role = 'tutor' and r.was_dispatch_active is not null then
      update public.tutor_profiles set is_dispatch_active = r.was_dispatch_active where id = r.profile_id;
    end if;
    if r.contact_email is not null and r.id = p_closure then
      perform public.closure_enqueue(r.id, r.profile_id, 'email', jsonb_build_object(
        'to', r.contact_email, 'template', 'reopened', 'subject', 'Your Tutorlage account is open again',
        'text', E'Your Tutorlage account is open again. Sessions that were cancelled when it was closed stay cancelled and refunded.\n\nTutorlage'));
    end if;
    update public.account_closures
    set status = 'undone', undone_at = now(), undone_by = v_admin, undone_note = btrim(p_asked_by) || ' / ' || btrim(p_how_verified) || ' / ' || btrim(p_note), contact_email = null
    where id = r.id;
    v_n := v_n + 1;
  end loop;
  perform public.closure_wake_worker();
  return jsonb_build_object('reopened', v_n);
end;
$$;

create or replace function public.defer_account_closure(p_closure uuid, p_until date, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_until is not null and (p_until <= current_date or length(btrim(coalesce(p_reason, ''))) < 3) then
    raise exception 'Give a date in the future and a short reason' using errcode = '22023';
  end if;
  update public.account_closures
  set deferred_until = p_until::timestamptz, deferred_reason = case when p_until is null then null else btrim(p_reason) end,
      deferred_by = case when p_until is null then null else v_admin end
  where id = p_closure and status in ('closed', 'db_deleted');
  if not found then
    raise exception 'No open closure with that id' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.list_account_closures(p_include_finished boolean default false)
returns table (
  closure_id uuid, profile_id uuid, role text, display_name text, email text, status text, started_how text, asked_by text, how_verified text,
  reference text, note text, household_of uuid, closed_at timestamptz, due_at timestamptz, outer_limit_at timestamptz, undo_until timestamptz,
  on_hold boolean, deferred_until timestamptz, deferred_reason text, open_dispute boolean, sessions_cancelled integer, cards_kept boolean,
  payout_kept boolean, open_tasks integer, overdue boolean, last_error text, record jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select c.id, c.profile_id, c.role, p.full_name::text, p.email::text, c.status, c.started_how, c.asked_by, c.how_verified, c.reference, c.note, c.household_of,
           c.closed_at, c.due_at, c.outer_limit_at, c.undo_until,
           public.profile_is_on_safety_hold(c.profile_id), c.deferred_until, c.deferred_reason, public.closure_has_open_dispute(c.profile_id),
           c.sessions_cancelled, c.cards_kept, c.payout_kept,
           (select count(*)::integer from public.account_closure_tasks t where t.closure_id = c.id and t.status in ('pending', 'claimed')),
           (c.status in ('closed', 'db_deleted') and c.outer_limit_at < now()),
           c.last_error,
           (select to_jsonb(d) - 'id' from public.account_deletion_records d where d.closure_id = c.id)
    from public.account_closures c
    left join public.profiles p on p.id = c.profile_id
    where p_include_finished or c.status in ('closed', 'db_deleted')
    order by c.closed_at desc;
end;
$$;

create or replace function public.read_account_tombstone(p_profile uuid)
returns table (profile_id uuid, closure_id uuid, role text, display_name text, closed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.closure_is_super_admin() then
    raise exception 'Only a super admin can read this' using errcode = '42501';
  end if;
  return query select t.profile_id, t.closure_id, t.role, t.display_name, t.closed_at from public.account_tombstones t where t.profile_id = p_profile;
end;
$$;

-- The day-30 deletion of one closure -----------------------------------------------------------------------------------------------

-- Cards and payout details: kept while a refund is unconfirmed (30 days at most) or money may be owed; retried daily.
create or replace function public.closure_delete_money(p_closure uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.account_closures;
  p uuid;
  v_codes text[];
  v_sub text;
begin
  select * into c from public.account_closures where id = p_closure for update;
  p := c.profile_id;
  if public.profile_is_on_safety_hold(p) then
    return;
  end if;
  if not exists (select 1 from public.session_requests r
                 where (r.student_id = p or r.requested_by_profile_id = p)
                   and r.payment_status in ('refund_pending', 'refund_queued', 'refund_needs_attention', 'refund_failed')
                   and coalesce(r.refund_requested_at, r.created_at) > now() - interval '30 days') then
    select array_agg(k.authorization_code) into v_codes from public.payment_cards k where k.profile_id = p;
    delete from public.payment_cards where profile_id = p;
    if v_codes is not null then
      perform public.closure_enqueue(c.id, p, 'paystack_cards', jsonb_build_object('authorization_codes', to_jsonb(v_codes)));
    end if;
  end if;
  if not exists (select 1 from public.payouts po where po.tutor_id = p and po.status in ('pending', 'processing', 'failed'))
     and not exists (select 1 from public.sessions s where s.tutor_id = p and s.status = 'completed' and s.completed_at > now() - interval '7 days') then
    for v_sub in select a.paystack_subaccount_code from public.tutor_payout_accounts a where a.tutor_id = p and a.paystack_subaccount_code is not null loop
      perform public.closure_enqueue(c.id, p, 'paystack_subaccount', jsonb_build_object('subaccount_code', v_sub));
    end loop;
    delete from public.tutor_payout_accounts where tutor_id = p;
  end if;
  update public.account_closures
  set cards_kept = exists (select 1 from public.payment_cards k where k.profile_id = p),
      payout_kept = exists (select 1 from public.tutor_payout_accounts a where a.tutor_id = p)
  where id = c.id;
end;
$$;

create or replace function public.closure_enqueue_files(p_closure uuid, p_profile uuid, p_bucket text, p_paths text[])
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare i integer := 1;
begin
  while i <= coalesce(array_length(p_paths, 1), 0) loop
    perform public.closure_enqueue(p_closure, p_profile, 'storage_remove', jsonb_build_object('bucket', p_bucket, 'paths', to_jsonb(p_paths[i:i + 49])));
    i := i + 50;
  end loop;
end;
$$;

create or replace function public.closure_delete_data(p_closure uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c public.account_closures;
  p uuid;
  v_name text;
  v_role text;
  v_del jsonb := '{}'::jsonb;
  n integer;
  v_paths text[];
  v_subject text;
  v_kept jsonb;
  v_days integer := public.closure_int_setting('account_closure_days_to_delete', 30);
begin
  select * into c from public.account_closures where id = p_closure for update;
  if not found or c.status <> 'closed' then
    return;
  end if;
  p := c.profile_id;
  perform pg_advisory_xact_lock(hashtextextended('safety_hold:' || p::text, 0));
  if public.profile_is_on_safety_hold(p) then
    return;
  end if;
  select pr.role::text, pr.full_name into v_role, v_name from public.profiles pr where pr.id = p;

  -- The person's own words and choices.
  delete from public.notifications where profile_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('notifications', n);
  delete from public.messages where sender_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('messages', n);
  delete from public.conversations cv where (cv.student_id = p or cv.tutor_id = p) and not exists (select 1 from public.messages m where m.conversation_id = cv.id);
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('conversations', n);
  delete from public.learner_tutor_choices where learner_id = p or tutor_id = p or chosen_by = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('learner_tutor_choices', n);
  delete from public.tutor_ended_pairings where learner_id = p or tutor_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_ended_pairings', n);
  delete from public.tutor_waitlist where student_id = p or requested_by = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_waitlist', n);
  delete from public.guardian_learner_intents where learner_id = p or guardian_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('guardian_learner_intents', n);
  delete from public.parent_student_links where parent_id = p or student_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('parent_student_links', n);
  update public.reviews set comment = null where (student_id = p or tutor_id = p) and comment is not null;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('review_comments', n);
  update public.sessions set meeting_url = null where (tutor_id = p or student_id = p or booked_by_profile_id = p) and meeting_url is not null;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('meeting_links', n);

  -- A learner: school, grade, availability, enrolments, school results (rows now; the files by the Worker).
  delete from public.student_availability where student_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('student_availability', n);
  delete from public.student_subject_enrollments where student_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('student_subject_enrollments', n);
  select coalesce(array_agg(o.name), '{}'::text[]) into v_paths from storage.objects o where o.bucket_id = 'school-results' and split_part(o.name, '/', 1) = p::text;
  v_paths := v_paths || coalesce((select array_agg(r.document_path) from public.school_results r
                                  where r.student_id = p and r.document_path is not null and not (r.document_path = any(v_paths))), '{}'::text[]);
  select count(*) into n from public.school_results where student_id = p;
  v_del := v_del || jsonb_build_object('school_results', n);
  for v_subject in select distinct r.subject_name from public.school_results r where r.student_id = p and r.status = 'verified' loop
    delete from public.school_results where student_id = p and subject_name = v_subject;
    perform public.refresh_school_progress(p, v_subject);
  end loop;
  delete from public.school_results where student_id = p;
  perform public.closure_enqueue_files(c.id, p, 'school-results', v_paths);

  -- A tutor: profile details, availability, subjects, languages, certificates; stray files in the documents folder.
  delete from public.tutor_availability where tutor_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_availability', n);
  delete from public.tutor_languages where tutor_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_languages', n);
  delete from public.tutor_certifications where tutor_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_certifications', n);
  delete from public.tutor_subject_competencies where tutor_id = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('tutor_subject_competencies', n);
  delete from public.subject_candidates where requested_by = p;
  get diagnostics n = row_count; v_del := v_del || jsonb_build_object('subject_candidates', n);
  select coalesce(array_agg(o.name), '{}'::text[]) into v_paths from storage.objects o
  where o.bucket_id = 'tutor-documents' and split_part(o.name, '/', 1) = p::text
    and not exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p and d.document_url = o.name)
    and not exists (select 1 from public.tier1_academic_records a where a.tutor_id = p and a.document_path = o.name);
  perform public.closure_enqueue_files(c.id, p, 'tutor-documents', v_paths);

  -- Cards and payout details (may stay, see closure_delete_money).
  perform public.closure_delete_money(c.id);

  -- The profile rows: blanked in place, never deleted.
  update public.student_profiles set first_name = '', surname = '', email = 'closed.' || p || '@closed.invalid', phone_number = null, school_id = null, grade_level = null where id = p;
  update public.parent_profiles set first_name = '', surname = '', email = 'closed.' || p || '@closed.invalid', phone_number = '', contact_preference = null, emergency_phone = null where id = p;
  update public.tutor_profiles set headline = null, institution_id = null, fast_track_proof_url = null, is_dispatch_active = false where id = p;
  update public.profiles
  set full_name = case v_role when 'tutor' then 'Former tutor' when 'parent' then 'Former guardian' else 'Former learner' end,
      email = 'closed.' || p || '@closed.invalid', phone_number = null, avatar_url = null, date_of_birth = null
  where id = p;

  -- The tombstone (an adult's name only) and the deletion record.
  insert into public.account_tombstones (profile_id, closure_id, role, display_name, closed_at)
  values (p, c.id, v_role, case when c.was_adult then v_name else null end, c.closed_at)
  on conflict (profile_id) do nothing;
  v_kept := jsonb_build_array(
    jsonb_build_object('what', 'bookings, payments, refunds and the session records behind them (pseudonymised)', 'why', 'accounting records', 'until', '7 years after the financial year'),
    jsonb_build_object('what', 'acceptance and consent records', 'why', 'evidence of what was agreed', 'until', '5 years after closing'),
    jsonb_build_object('what', 'tutor ID copy, police clearance and verification documents', 'why', 'safety, the tutor''s consent', 'until', '3 years after closing'),
    jsonb_build_object('what', 'problem and safety reports', 'why', 'our own choice (Privacy §14)', 'until', '5 years'),
    jsonb_build_object('what', 'ratings, marks and test answers as anonymous numbers', 'why', 'to keep levels and tests fair', 'until', 'while used'),
    jsonb_build_object('what', 'document-access log, hold lines and hand-over records', 'why', 'proof of who saw what', 'until', 'as built'));
  insert into public.account_deletion_records (closure_id, profile_id, role, started_by, started_how, closed_at, deleted, kept, outside)
  values (c.id, p, v_role, c.started_by, c.started_how, c.closed_at, v_del, v_kept,
          jsonb_build_array('Paystack: saved-card authorisations and the tutor''s subaccount (best effort, by the Worker)',
                            'Auth user and Google link (by the Worker)', 'Stored files (by the Worker)',
                            'Resend and Cloudflare logs, the mailbox, and backups: not reachable from here'));

  -- The final email carries the address (the only copy left); then the Worker steps. The Auth user goes last.
  if c.contact_email is not null then
    perform public.closure_enqueue(c.id, p, 'email', jsonb_build_object(
      'to', c.contact_email, 'template', 'final', 'subject', 'Your Tutorlage account details have been deleted',
      'text', format(E'We have deleted your Tutorlage account details: your name, email, phone number, sign-in, saved cards, messages and school results.\n\nWe keep some records without your name, because the law or an open matter requires it: bookings and payments for 7 years, what you agreed to for 5 years, tutor verification documents for 3 years, and problem reports for 5 years. %s\n\nTutorlage', public.closure_text() ->> 'note')));
  end if;
  perform public.closure_enqueue(c.id, p, 'auth_delete', jsonb_build_object('user_id', p));
  update public.account_closures set status = 'db_deleted', db_deleted_at = now(), contact_email = null, last_error = null where id = c.id;
end;
$$;

-- The daily job ------------------------------------------------------------------------------------------------------------------

create or replace function public.run_account_closures()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c record;
  n_done integer := 0;
  n_held integer := 0;
  n_wait integer := 0;
  n_err integer := 0;
  n_finished integer := 0;
  n_overdue integer := 0;
begin
  for c in select x.id, x.profile_id, x.deferred_until from public.account_closures x where x.status = 'closed' and x.due_at <= now() order by x.due_at loop
    begin
      if public.profile_is_on_safety_hold(c.profile_id) then
        n_held := n_held + 1;
      elsif (c.deferred_until is not null and c.deferred_until > now()) or public.closure_has_open_dispute(c.profile_id) then
        n_wait := n_wait + 1;
      else
        perform public.closure_delete_data(c.id);
        n_done := n_done + 1;
      end if;
    exception when others then
      n_err := n_err + 1;
      update public.account_closures set last_error = left(sqlerrm, 300), last_error_at = now() where id = c.id;
    end;
  end loop;

  -- Cards and payout details that had to wait are tried again.
  for c in select x.id from public.account_closures x where x.status = 'db_deleted' and (x.cards_kept or x.payout_kept) loop
    begin
      perform public.closure_delete_money(c.id);
    exception when others then
      update public.account_closures set last_error = left(sqlerrm, 300), last_error_at = now() where id = c.id;
    end;
  end loop;

  -- A step tried 5 times is given up. An email still unsent at the outer limit is given up too: the address in it is destroyed.
  update public.account_closure_tasks t
  set status = 'gave_up',
      last_error = coalesce(t.last_error, 'gave up: ' || case when t.attempts >= 5 then 'too many tries' else 'past the outer limit' end),
      payload = t.payload - 'to' - 'text' - 'authorization_codes' - 'paths'
  where t.status in ('pending', 'claimed')
    and ((t.attempts >= 5 and (t.status = 'pending' or t.claimed_at < now() - interval '15 minutes'))
         or (t.kind = 'email' and exists (select 1 from public.account_closures x where x.id = t.closure_id and x.outer_limit_at < now())));

  update public.account_closures x
  set status = 'done', done_at = now()
  where x.status = 'db_deleted' and not x.cards_kept and not x.payout_kept
    and not exists (select 1 from public.account_closure_tasks t where t.closure_id = x.id and t.status in ('pending', 'claimed'));
  get diagnostics n_finished = row_count;

  for c in select x.id, x.status from public.account_closures x
           where x.status in ('closed', 'db_deleted') and x.outer_limit_at < now() and x.overdue_alerted_at is null
             and not public.profile_is_on_safety_hold(x.profile_id) loop
    perform public.notify_active_admins('closure_overdue', 'An account closure is past its outer limit',
      'Closure ' || c.id || ' (' || c.status || ') is past day ' || public.closure_int_setting('account_closure_days_outer_limit', 90)
      || ' and is not finished. Open the closures list to see what it is waiting for.');
    update public.account_closures set overdue_alerted_at = now() where id = c.id;
    n_overdue := n_overdue + 1;
  end loop;

  perform public.closure_wake_worker();
  return jsonb_build_object('deleted', n_done, 'held', n_held, 'waiting', n_wait, 'errors', n_err, 'finished', n_finished, 'overdue_alerts', n_overdue);
end;
$$;

-- The Worker's two calls (server key only) -----------------------------------------------------------------------------------------

create or replace function public.close_account_claim_tasks(p_limit integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_safe boolean := public.closure_auth_link_is_safe();
  v_out jsonb;
begin
  -- Handed out in this order: emails, then card and subaccount steps, then files, the Auth delete last (it only comes when the person's
  -- other steps are all finished). The list returned is in the same order, so the Worker does them in that order.
  with picked as (
    select t.id, case t.kind when 'email' then 1 when 'paystack_cards' then 2 when 'paystack_subaccount' then 2 when 'storage_remove' then 3 else 9 end as rk
    from public.account_closure_tasks t
    where ((t.status = 'pending' and (t.claimed_at is null or t.claimed_at < now() - interval '10 minutes'))
           or (t.status = 'claimed' and t.claimed_at < now() - interval '15 minutes')) and t.attempts < 5
      and (t.kind <> 'auth_delete'
           or (v_safe and not exists (select 1 from public.account_closure_tasks o
                                      where o.closure_id = t.closure_id and o.kind <> 'auth_delete' and o.status in ('pending', 'claimed'))))
    order by rk, t.id
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), upd as (
    update public.account_closure_tasks t
    set status = 'claimed', attempts = t.attempts + 1, claimed_at = now()
    from picked where t.id = picked.id
    returning t.id, t.closure_id, t.kind, t.payload, t.attempts, picked.rk
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'closure_id', u.closure_id, 'kind', u.kind, 'payload', u.payload, 'attempts', u.attempts) order by u.rk, u.id), '[]'::jsonb)
  into v_out from upd u;
  return v_out;
end;
$$;

-- p_waiting = true means "not the task's fault, try again later" (for example no mail key yet): the try is not counted.
create or replace function public.close_account_task_result(p_task bigint, p_ok boolean, p_detail text default null, p_waiting boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t public.account_closure_tasks;
begin
  select * into t from public.account_closure_tasks where id = p_task for update;
  if not found or t.status <> 'claimed' then
    return;
  end if;
  if coalesce(p_ok, false) then
    update public.account_closure_tasks
    set status = 'done', done_at = now(), last_error = null, payload = payload - 'to' - 'text' - 'authorization_codes' - 'paths'
    where id = p_task;
  elsif coalesce(p_waiting, false) then
    update public.account_closure_tasks set status = 'pending', attempts = greatest(attempts - 1, 0), last_error = left(coalesce(p_detail, 'waiting'), 300) where id = p_task;
  elsif t.attempts >= 5 then
    update public.account_closure_tasks
    set status = 'gave_up', last_error = left(coalesce(p_detail, 'failed'), 300), payload = payload - 'to' - 'text' - 'authorization_codes' - 'paths'
    where id = p_task;
    perform public.notify_active_admins('closure_step_failed', 'A closure step could not be completed',
      'Closure ' || t.closure_id || ': the "' || t.kind || '" step failed 5 times (' || left(coalesce(p_detail, 'no detail'), 150) || ').');
  else
    update public.account_closure_tasks set status = 'pending', last_error = left(coalesce(p_detail, 'failed'), 300) where id = p_task;
  end if;
end;
$$;

-- Rights ------------------------------------------------------------------------------------------------------------------------------
-- Internal: nobody through the API (the daily job runs as the owner).
revoke all on function public.closure_int_setting(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.closure_is_adult(uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_is_super_admin() from public, anon, authenticated, service_role;
revoke all on function public.closure_busy(uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_has_open_dispute(uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_enqueue(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.closure_text() from public, anon, authenticated, service_role;
revoke all on function public.closure_household(uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_targets(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_refund(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.closure_cancel_session(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.closure_start(uuid, uuid, text, uuid, text, timestamptz, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.closure_run(uuid[], uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.closure_wake_worker() from public, anon, authenticated, service_role;
revoke all on function public.closure_auth_link_is_safe() from public, anon, authenticated, service_role;
revoke all on function public.closure_delete_money(uuid) from public, anon, authenticated, service_role;
revoke all on function public.closure_enqueue_files(uuid, uuid, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.closure_delete_data(uuid) from public, anon, authenticated, service_role;
revoke all on function public.run_account_closures() from public, anon, authenticated, service_role;
-- Signed-in people and admins.
revoke all on function public.preview_account_closure(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_account_closure(uuid) to authenticated;
revoke all on function public.request_account_closure(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_account_closure(text, uuid) to authenticated;
revoke all on function public.admin_close_account(uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_close_account(uuid, text, text, timestamptz, text, text, text) to authenticated;
revoke all on function public.undo_account_closure(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.undo_account_closure(uuid, text, text, text) to authenticated;
revoke all on function public.defer_account_closure(uuid, date, text) from public, anon, authenticated, service_role;
grant execute on function public.defer_account_closure(uuid, date, text) to authenticated;
revoke all on function public.list_account_closures(boolean) from public, anon, authenticated, service_role;
grant execute on function public.list_account_closures(boolean) to authenticated;
revoke all on function public.read_account_tombstone(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_account_tombstone(uuid) to authenticated;
-- The Worker (server key).
revoke all on function public.close_account_claim_tasks(integer) from public, anon, authenticated;
grant execute on function public.close_account_claim_tasks(integer) to service_role;
revoke all on function public.close_account_task_result(bigint, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.close_account_task_result(bigint, boolean, text, boolean) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('run-account-closures') where exists (select 1 from cron.job where jobname = 'run-account-closures');
    perform cron.schedule('run-account-closures', '10 3 * * *', 'select public.run_account_closures();');
  end if;
end $$;
