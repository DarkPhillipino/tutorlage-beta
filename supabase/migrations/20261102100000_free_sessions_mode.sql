-- FREE SESSIONS MODE (CEO, 2 Nov 2026, through the PM): while payments are not open, a learner can send a request with NO card check, a
-- tutor can accept it, and the session can be held and completed with no money. Built behind a switch that is OFF by default:
--   system_settings.free_sessions_enabled = true   (edited in the admin app, System Settings; nothing else needs a publish after the first)
-- The CEO's three answers: (1) free sessions DO count towards a tutor's hours, ratings and level (a free session is an ordinary completed
-- session as far as levels go); (2) they are FLAGGED and kept out of every earnings and payout sum when payments return (sessions.free_session,
-- and the session's gross_amount, tutor_payout_amount and platform_commission_pct are stored as 0); (3) the screens say so plainly (the app).
--
-- How a free request travels (no new matching rule, no Worker change):
--   1. the learner's request is inserted as always ('initiated'); send_request_free() then moves it to 'card_verified' with free_session = true
--      and no card (exactly what a verified card check does), so tutor visibility, best-fit-first matching, the 48-hour window, expiry and
--      the "sent to you" notice all behave as for any request;
--   2. a tutor accepts through the Worker as today: claim_session_request() runs every check, then (free) books the session through
--      create_free_session() and answers mode 'already_paid', which the Worker already turns into "booked";
--   3. the request ends as payment_status 'free' (a new value), so no refund, charge, recovery or cancellation-window code ever treats it as money.
--
-- What this migration does, all of it additive or a small in-place patch of an existing function:
--   NEW   system_settings row free_sessions_enabled (false)
--   NEW   columns session_requests.free_session and sessions.free_session (default false); trigger guard_free_flag stops a signed-in user
--         inserting a request with the flag set
--   NEW   payment_status value 'free' (check constraint rebuilt with the same list plus 'free')
--   NEW   free_sessions_open() (anyone may ask), send_request_free(uuid) (the requester only, only while the switch is on),
--         create_free_session(uuid, uuid) (private), free_request_ids(uuid[]) and free_session_ids(uuid[]) (which of these are free)
--   PATCHES claim_session_request(uuid, uuid): ONE block inserted after the fit check
--   PATCHES cancel_session(uuid, text): a free branch before the refund checks
--   PATCHES closure_cancel_session(uuid, boolean): a free branch before the refund branch
-- Nothing is dropped. No existing row changes. With the switch off nothing behaves differently (no request can become free).

-- 1. the switch ---------------------------------------------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value)
values ('free_sessions_enabled', 'false'::jsonb)
on conflict (setting_key) do nothing;

-- 2. the flags and the new payment state --------------------------------------------------------------------------------------------------
alter table public.session_requests add column if not exists free_session boolean not null default false;
alter table public.sessions add column if not exists free_session boolean not null default false;

alter table public.session_requests drop constraint if exists session_requests_payment_status_check;
alter table public.session_requests add constraint session_requests_payment_status_check
  check (payment_status in ('unpaid', 'initiated', 'card_verified', 'charging', 'charge_failed', 'paid',
                            'refund_pending', 'refund_queued', 'refund_needs_attention', 'refunded', 'refund_failed', 'failed', 'free'));

-- A signed-in user can never insert a request that is already marked free: only send_request_free() (below) sets the flag.
create or replace function public.guard_free_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.free_session := false;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_free_flag on public.session_requests;
create trigger guard_free_flag before insert on public.session_requests
  for each row execute function public.guard_free_flag();

-- 3. who may ask whether free sessions are open ---------------------------------------------------------------------------------------------
create or replace function public.free_sessions_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select lower(coalesce(setting_value #>> '{}', '')) = 'true' from public.system_settings where setting_key = 'free_sessions_enabled'),
    false);
$$;
revoke all on function public.free_sessions_open() from public;
grant execute on function public.free_sessions_open() to anon, authenticated;

-- 4. the learner sends a request without a card check -----------------------------------------------------------------------------------------
create or replace function public.send_request_free(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.free_sessions_open() then
    raise exception 'Free sessions are not open.' using errcode = '42501';
  end if;
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.requested_by_profile_id is distinct from v_uid then
    raise exception 'That request is not yours, or does not exist.' using errcode = '42501';
  end if;
  if v_req.free_session and v_req.payment_status = 'card_verified' then
    return 'free';  -- already sent: repeat calls change nothing
  end if;
  if v_req.payment_status <> 'initiated' or v_req.status <> 'pending' then
    raise exception 'This request has already been sent.';
  end if;
  -- The same move a verified card check makes, without a card. The "sent to you" notice fires from this update when the request is
  -- addressed to a tutor (trg_notify_tutor_of_addressed_request).
  update public.session_requests set payment_status = 'card_verified', free_session = true where id = p_request_id;
  return 'free';
end;
$$;
revoke all on function public.send_request_free(uuid) from public, anon;
grant execute on function public.send_request_free(uuid) to authenticated;

-- 5. booking a free session (private: only claim_session_request calls it) --------------------------------------------------------------------
create or replace function public.create_free_session(p_request_id uuid, p_tutor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_session_id uuid;
begin
  select * into v_req from public.session_requests where id = p_request_id;
  -- Money is stored as 0, not as the price: no earnings or payout sum can ever include a free session, and the flag says why.
  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status, free_session
  ) values (
    v_req.student_id, p_tutor_id, v_req.duration_hours, round(v_req.charged_amount / v_req.duration_hours, 2),
    0, 0, 0,
    v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.currency_code,
    'scheduled', true
  ) returning id into v_session_id;

  update public.session_requests
  set tutor_id = p_tutor_id, status = 'accepted', responded_at = now(), resulting_session_id = v_session_id,
      payment_status = 'free', commission_amount = 0
  where id = p_request_id;

  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select distinct p, 'request_accepted', 'A tutor accepted your request',
         'Your session is booked. It is a free session, so you will not be charged. Open Sessions to see your tutor and, closer to the time, the meeting link.',
         v_session_id
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
  return v_session_id;
end;
$$;
revoke all on function public.create_free_session(uuid, uuid) from public, anon, authenticated;

-- 6. which of these requests / sessions are free (so a screen can say so) -----------------------------------------------------------------------
create or replace function public.free_request_ids(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id from public.session_requests r where r.id = any (p_ids) and r.free_session;
$$;
revoke all on function public.free_request_ids(uuid[]) from public, anon;
grant execute on function public.free_request_ids(uuid[]) to authenticated;

create or replace function public.free_session_ids(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id from public.sessions s where s.id = any (p_ids) and s.free_session;
$$;
revoke all on function public.free_session_ids(uuid[]) from public, anon;
grant execute on function public.free_session_ids(uuid[]) to authenticated;

-- 7. THE THREE REPLACED FUNCTIONS, PATCHED IN PLACE ---------------------------------------------------------------------------------------------
-- Each function is read from the database as it is now (pg_get_functiondef), the anchor line is checked to occur EXACTLY once (otherwise
-- this migration stops and changes nothing), the free block is inserted after it, and the function is recreated with the same attributes
-- and rights. Written this way so dev and production cannot drift (their stored text differs in line endings and comments) and so a
-- later change to an anchor is caught here instead of silently skipped. Running it twice is harmless (a function that already has the
-- block is left alone).
create or replace function pg_temp.patch_function(p_sig regprocedure, p_anchor text, p_closing text, p_new_block text, p_replace_anchor boolean default false)
returns text
language plpgsql
as $patch$
declare
  d text;
  parts text[];
  pos int;
  pos2 int;
begin
  d := replace(pg_get_functiondef(p_sig), chr(13), '');
  if strpos(d, 'FREE SESSIONS (CEO, 2 Nov 2026)') > 0 then
    return p_sig::text || ': already patched';
  end if;
  parts := string_to_array(d, p_anchor);
  if array_length(parts, 1) is distinct from 2 then
    raise exception 'free sessions patch: the anchor line was found % time(s) in %, expected exactly once', coalesce(array_length(parts, 1), 1) - 1, p_sig;
  end if;
  pos := strpos(d, p_anchor);
  if p_replace_anchor then
    d := substr(d, 1, pos - 1) || p_new_block || substr(d, pos + length(p_anchor));
  else
    pos2 := strpos(substr(d, pos), p_closing);
    if pos2 = 0 then
      raise exception 'free sessions patch: no closing "%" after the anchor in %', p_closing, p_sig;
    end if;
    pos2 := pos + pos2 - 1 + length(p_closing);
    d := substr(d, 1, pos2 - 1) || p_new_block || substr(d, pos2);
  end if;
  execute d;
  return p_sig::text || ': patched';
end;
$patch$;

-- claim_session_request: a free request is booked after every eligibility check, before any money step (the Worker reads mode 'already_paid')
select pg_temp.patch_function(
  'public.claim_session_request(uuid, uuid)'::regprocedure,
  'raise exception ''%'', public.tutor_fit_sentence(v_fit);',
  'end if;',
  $blk$

  -- FREE SESSIONS (CEO, 2 Nov 2026): a request sent without a card check is booked now, with no charge, no bank account and no
  -- commission. The Worker reads mode 'already_paid' and answers "booked", so the Worker does not change. Every check above still applies.
  if v_req.free_session then
    return jsonb_build_object('mode', 'already_paid', 'session_id', public.create_free_session(p_request_id, p_tutor_id));
  end if;
$blk$);

-- cancel_session: a free session is cancelled with nothing to refund
select pg_temp.patch_function(
  'public.cancel_session(uuid, text)'::regprocedure,
  'select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;',
  ';',
  $blk$

  -- FREE SESSIONS (CEO, 2 Nov 2026): nothing was charged, so there is nothing to refund and no cancellation window to check.
  if found and v_request.payment_status = 'free' then
    update public.sessions
    set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                      else 'cancelled_by_student'::public.session_status end
    where id = p_session_id;
    update public.session_requests set status = 'cancelled' where id = v_request.id;
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    values (
      case when v_by_tutor then v_session.student_id else v_session.tutor_id end,
      'session_cancelled',
      'A session was cancelled',
      case when v_by_tutor then 'Your tutor cancelled the session. It was a free session, so there is nothing to refund.'
           else 'The learner cancelled the session.' end
        || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
      p_session_id
    );
    return;
  end if;
$blk$);

-- closure_cancel_session: a free session is cancelled quietly (no admin alert about "nothing to refund")
select pg_temp.patch_function(
  'public.closure_cancel_session(uuid, boolean)'::regprocedure,
  'if found and v_r.payment_status = ''paid'' then',
  null,
  $blk$-- FREE SESSIONS (CEO, 2 Nov 2026): nothing was charged, so nothing to refund and nothing for an admin to check.
  if found and v_r.payment_status = 'free' then
    update public.session_requests set status = 'cancelled' where id = v_r.id and status <> 'cancelled';
    v_out := 'cancelled';
  elsif found and v_r.payment_status = 'paid' then$blk$,
  true);
