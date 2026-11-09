-- PROMO CODES: 10 percent off a parent's first 3 lessons, by code (CEO's decision of 5 Nov 2026; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md 8.2).
-- Apply AFTER 20261105200000_promo_codes_audit_actions.sql (it adds three enum values and must commit first) and after the wallet migrations (it patches
-- their functions in place). With no code created, nothing behaves differently: no account has a code, so no request carries a discount.
--
-- THE RULE (defaults the CEO can change per code):
--   * A code gives percent_off (default 10) on the price of each of the payer's first uses_per_account (default 3) wallet-paid lessons. The payer is the person
--     whose wallet pays (the parent; an adult learner paying for themself). The code is stored on the payer's PROFILE (attribution), from sign-up or from an
--     admin attaching it later.
--   * The discount comes out of Tutorlage's share. The TUTOR'S PAY NEVER CHANGES: it is the level price (before the discount) less the level's commission,
--     with the commission rounded to the nearest whole rand exactly as the wallet already does. The parent's hold and charge are the level price less the
--     discount, rounded to the nearest whole rand (the existing rounding rule). Worked at the live level prices, one hour:
--         1A  price R50   parent pays R45    tutor R35   Tutorlage R10     (without a code R15)
--         1D  price R150  parent pays R135   tutor R105  Tutorlage R30     (without a code R45)
--         2C  price R280  parent pays R252   tutor R207  Tutorlage R45     (without a code R73; the 26 percent commission, R72.80, is rounded to R73 for
--                                                                            everyone today, so the tutor has always had R207, never R207.20)
--     All 16 level prices are multiples of R10, so a whole-hour lesson is always a whole rand at 10 percent off. A half-hour R25 lesson (1A) is R22.50 off
--     the price, which rounds to R23.
--   * A "use" is taken when the request is sent (the hold) and returned when the request ends without a lesson (expired, declined, cancelled) or the booked
--     session is cancelled / the account closed (payment_status wallet_refunded): ONE trigger on session_requests covers every path, today's and any added
--     later. A lesson that was delivered (completed) keeps its use, even if finance later refunds money after the lesson. Live uses (not returned) are
--     counted, so four requests sent at once can never take more than uses_per_account.
--   * Refunds return what was paid (the stored hold). The platform's share is gross_amount - tutor_payout_amount on the session.
--   * End date and pause: valid_from / valid_until / max_families decide who can be ATTACHED to the code (at sign-up or by an admin). A family that is
--     attached keeps its lessons after the end date. Pausing a code (active = false) stops EVERYTHING at once: nobody is attached and no new lesson gets the
--     discount (requests already sent keep theirs).
--   * Card payments are unchanged (cards are closed today): the discount is a wallet-only rule. A card request never carries one.
--
-- WHO CAN DO WHAT:
--   * Codes and their uses are never readable or writable by a parent, a learner or a tutor. A parent reads only their own use rows.
--   * Only an active FINANCE admin (finance_manager or super_admin, public.wallet_is_finance_admin(), the same rule as the wallet) can create, edit, pause,
--     attach or see codes; every one goes through a SECURITY DEFINER function that writes an audit row. No table policy allows a direct write.
--   * A signed-out or signed-in visitor can ask check_promo_code(code): it answers valid or not, with the percent and the number of lessons, and nothing else.
--     Failed guesses are counted (10 an hour per person, 200 a quarter-hour for everyone), after which every answer is "try again later".
--
-- WHAT THIS MIGRATION ADDS:
--   TABLES   promo_codes, promo_code_uses, promo_code_attempts
--   COLUMNS  profiles.promo_code_id / promo_code_entered / promo_attached_at / promo_attached_by (no client can read or write them: profiles has column-level
--            select and no update right); session_requests.promo_discount_rand; sessions.promo_discount_rand
--   FUNCTIONS check_promo_code (open to signed-out visitors: the sign-up page asks before the account exists), attach_my_promo_code, my_promo_quote (signed in);
--            admin_create_promo_code, admin_update_promo_code, admin_set_promo_code_active, admin_attach_promo_code, admin_list_promo_codes (finance admins);
--            internal: promo_normalise, promo_paid_rand, promo_attempt_key, promo_attempts_blocked, promo_find_open_code, promo_attach_at_signup,
--            promo_quote_row, promo_take_use, and three triggers (guard, return a use, link the session)
--   PATCHES (each in place; the anchor must occur exactly the stated number of times or the migration stops and changes nothing; a marker makes a re-run a no-op)
--            handle_new_user_role_expansion (reads the code from the sign-up metadata, wrapped so a problem with a code can never block a sign-up),
--            send_request_wallet, resend_request_without_card, create_wallet_session, wallet_credit_tutor, expire_stale_paid_requests, decline_session_request
-- Nothing is dropped. No existing row changes.

-- 1. the tables ----------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  label text not null default '' check (length(label) <= 80),                 -- the channel: a faculty, a school, a tutor
  percent_off integer not null default 10 check (percent_off between 1 and 30),  -- 30 is a safety limit, not a target
  uses_per_account integer not null default 3 check (uses_per_account between 1 and 20),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  max_families integer check (max_families is null or max_families between 1 and 100000),
  active boolean not null default true,
  referring_tutor_id uuid references public.tutor_profiles (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_window check (valid_until is null or valid_until > valid_from)
);
create unique index if not exists promo_codes_code_upper on public.promo_codes (upper(code));

-- A code is stored in capitals whatever was typed, and never changes once made (it is printed in messages).
create or replace function public.promo_codes_normalise()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.code := upper(btrim(new.code));
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'A code cannot be renamed. Make a new one and pause this one.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.promo_codes_normalise() from public, anon, authenticated, service_role;
drop trigger if exists promo_codes_normalise on public.promo_codes;
create trigger promo_codes_normalise before insert or update on public.promo_codes
  for each row execute function public.promo_codes_normalise();

-- One row per request that carried a discount. No foreign keys to requests, sessions or profiles on purpose (the wallet tables work the same way): a money
-- record must survive the thing it describes.
create table if not exists public.promo_code_uses (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.promo_codes (id),
  profile_id uuid not null,
  request_id uuid not null,
  session_id uuid,
  percent_off integer not null,
  list_rand integer not null check (list_rand > 0),
  amount_off integer not null check (amount_off > 0),
  lesson_number integer not null check (lesson_number >= 1),
  created_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_reason text check (length(returned_reason) <= 200),
  constraint promo_code_uses_request_key unique (request_id)
);
create index if not exists promo_code_uses_profile on public.promo_code_uses (profile_id, code_id) where returned_at is null;
create index if not exists promo_code_uses_code on public.promo_code_uses (code_id);

-- Failed guesses, for the attempt limit. Nobody reads this through the API.
create table if not exists public.promo_code_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  at timestamptz not null default now()
);
create index if not exists promo_code_attempts_bucket on public.promo_code_attempts (bucket, at);
create index if not exists promo_code_attempts_at on public.promo_code_attempts (at);

alter table public.promo_codes enable row level security;
alter table public.promo_code_uses enable row level security;
alter table public.promo_code_attempts enable row level security;
revoke all on public.promo_codes, public.promo_code_uses, public.promo_code_attempts from public, anon, authenticated, service_role;
drop policy if exists "Finance admins read promo codes" on public.promo_codes;
create policy "Finance admins read promo codes" on public.promo_codes for select to authenticated using (public.wallet_is_finance_admin());
drop policy if exists "Owner or finance admin reads promo uses" on public.promo_code_uses;
create policy "Owner or finance admin reads promo uses" on public.promo_code_uses for select to authenticated
  using (profile_id = auth.uid() or public.wallet_is_finance_admin());
grant select on public.promo_codes, public.promo_code_uses to authenticated;
-- (no policy and no grant for any write, and none at all for promo_code_attempts: only the functions below touch them)

-- 2. who came with which code, and the discount on a request / session -------------------------------------------------------------------------------
alter table public.profiles add column if not exists promo_code_id uuid references public.promo_codes (id) on delete set null;
alter table public.profiles add column if not exists promo_code_entered text check (length(promo_code_entered) <= 40);   -- what was typed (kept even when it was not a valid code, so an admin can see it)
alter table public.profiles add column if not exists promo_attached_at timestamptz;
alter table public.profiles add column if not exists promo_attached_by uuid;      -- an admin, when the code was attached by hand; null = at sign-up
create index if not exists profiles_promo_code on public.profiles (promo_code_id) where promo_code_id is not null;

alter table public.session_requests add column if not exists promo_discount_rand integer not null default 0 check (promo_discount_rand >= 0);
alter table public.sessions add column if not exists promo_discount_rand integer not null default 0 check (promo_discount_rand >= 0);
alter table public.session_requests drop constraint if exists session_requests_promo_shape;
alter table public.session_requests add constraint session_requests_promo_shape check (promo_discount_rand = 0 or paid_from_wallet);

-- Only the functions below set a discount. A signed-in user inserting a row gets 0; updating cannot change it. The server and the owner are not held to this.
create or replace function public.guard_promo_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.promo_discount_rand := case when tg_op = 'INSERT' then 0 else old.promo_discount_rand end;
  return new;
end;
$$;
revoke all on function public.guard_promo_flags() from public, anon, authenticated, service_role;
drop trigger if exists guard_promo_flags on public.session_requests;
create trigger guard_promo_flags before insert or update on public.session_requests
  for each row execute function public.guard_promo_flags();
drop trigger if exists guard_promo_flags on public.sessions;
create trigger guard_promo_flags before insert or update on public.sessions
  for each row execute function public.guard_promo_flags();

-- 3. small helpers ---------------------------------------------------------------------------------------------------------------------------------
-- The one shape of a code: 3 to 32 letters, digits, - or _, in capitals. null = not a code (nothing to look up).
create or replace function public.promo_normalise(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when upper(btrim(coalesce(p_code, ''))) ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then upper(btrim(p_code)) end;
$$;
revoke all on function public.promo_normalise(text) from public, anon, authenticated, service_role;

-- What the parent pays for a price after the discount: the nearest whole rand (halves up), the same rule the price itself is rounded by.
create or replace function public.promo_paid_rand(p_list integer, p_percent integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select round(p_list::numeric * (100 - p_percent) / 100)::integer;
$$;
revoke all on function public.promo_paid_rand(integer, integer) from public, anon, authenticated, service_role;

-- Whose guesses are counted together: the signed-in person, or for a signed-out visitor the address the request came from (when the gateway tells us).
create or replace function public.promo_attempt_key()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ip text;
begin
  if auth.uid() is not null then
    return 'u:' || auth.uid()::text;
  end if;
  begin
    v_ip := nullif(btrim(split_part(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;
  return 'ip:' || coalesce(left(v_ip, 64), 'unknown');
end;
$$;
revoke all on function public.promo_attempt_key() from public, anon, authenticated, service_role;

create or replace function public.promo_attempts_blocked(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.promo_code_attempts where bucket = p_key and at > now() - interval '1 hour') >= 10
      or (select count(*) from public.promo_code_attempts where at > now() - interval '15 minutes') >= 200;
$$;
revoke all on function public.promo_attempts_blocked(text) from public, anon, authenticated, service_role;

-- The code row for a typed code, only while a NEW family may still be attached to it: active, inside its dates, and the cap of families not reached.
-- (An empty row comes back when there is no such code.)
create or replace function public.promo_find_open_code(p_norm text)
returns public.promo_codes
language sql
stable
security definer
set search_path = public
as $$
  select c.*
    from public.promo_codes c
   where upper(c.code) = p_norm
     and c.active
     and now() >= c.valid_from
     and (c.valid_until is null or now() < c.valid_until)
     and (c.max_families is null or (select count(*) from public.profiles p where p.promo_code_id = c.id) < c.max_families);
$$;
revoke all on function public.promo_find_open_code(text) from public, anon, authenticated, service_role;

-- 4. the public question: is this code good? ------------------------------------------------------------------------------------------------------
create or replace function public.check_promo_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_norm text := public.promo_normalise(p_code);
  v_key text := public.promo_attempt_key();
  c public.promo_codes;
begin
  if v_norm is null then
    return jsonb_build_object('valid', false);          -- empty, or not the shape of a code: nothing to look up, nothing counted
  end if;
  if public.promo_attempts_blocked(v_key) then
    return jsonb_build_object('valid', false, 'limited', true);
  end if;
  c := public.promo_find_open_code(v_norm);
  if c.id is null then
    insert into public.promo_code_attempts (bucket) values (v_key);
    delete from public.promo_code_attempts where at < now() - interval '2 days';
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object('valid', true, 'percent', c.percent_off, 'lessons', c.uses_per_account);
end;
$$;
revoke all on function public.check_promo_code(text) from public;
grant execute on function public.check_promo_code(text) to anon, authenticated;

-- 5. attaching a code to an account ----------------------------------------------------------------------------------------------------------------
-- At sign-up (called by the sign-up trigger, which is patched below). Only parent and learner accounts pay, so only they carry a code. A typed code that is not
-- valid is still kept (profiles.promo_code_entered) so an admin can see what was typed and attach the right one by hand.
create or replace function public.promo_attach_at_signup(p_profile uuid, p_role text, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.promo_normalise(p_code);
  v_raw text := left(nullif(btrim(coalesce(p_code, '')), ''), 40);
  c public.promo_codes;
begin
  if p_role not in ('parent', 'student') or v_raw is null then
    return;
  end if;
  if v_norm is not null then
    perform 1 from public.promo_codes where upper(code) = v_norm for update;   -- one sign-up at a time per code, so the cap of families cannot be passed
    c := public.promo_find_open_code(v_norm);
  end if;
  if c.id is not null then
    update public.profiles set promo_code_id = c.id, promo_code_entered = v_norm, promo_attached_at = now()
     where id = p_profile and promo_code_id is null;
  else
    update public.profiles set promo_code_entered = upper(v_raw) where id = p_profile and promo_code_id is null;
  end if;
end;
$$;
revoke all on function public.promo_attach_at_signup(uuid, text, text) from public, anon, authenticated, service_role;

-- A person who signed up through Google (no sign-up form to carry the code) claims it right after, from the link they arrived by. Only a parent or learner
-- account made in the last 24 hours with no code yet; guesses are counted like check_promo_code. Anything later goes through an admin.
create or replace function public.attach_my_promo_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text := public.promo_normalise(p_code);
  v_key text := public.promo_attempt_key();
  p record;
  c public.promo_codes;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select id, role::text as role, created_at, promo_code_id into p from public.profiles where id = v_uid;
  if not found or p.role not in ('parent', 'student') then
    return jsonb_build_object('attached', false, 'reason', 'not_eligible');
  end if;
  if p.promo_code_id is not null then
    return jsonb_build_object('attached', false, 'reason', 'already_has_code');
  end if;
  if p.created_at < now() - interval '24 hours' then
    return jsonb_build_object('attached', false, 'reason', 'too_late');
  end if;
  if v_norm is null then
    return jsonb_build_object('attached', false, 'reason', 'invalid');
  end if;
  if public.promo_attempts_blocked(v_key) then
    return jsonb_build_object('attached', false, 'reason', 'limited');
  end if;
  perform 1 from public.promo_codes where upper(code) = v_norm for update;
  c := public.promo_find_open_code(v_norm);
  if c.id is null then
    insert into public.promo_code_attempts (bucket) values (v_key);
    return jsonb_build_object('attached', false, 'reason', 'invalid');
  end if;
  update public.profiles set promo_code_id = c.id, promo_code_entered = v_norm, promo_attached_at = now() where id = v_uid;
  return jsonb_build_object('attached', true, 'percent', c.percent_off, 'lessons', c.uses_per_account);
end;
$$;
revoke all on function public.attach_my_promo_code(text) from public, anon;
grant execute on function public.attach_my_promo_code(text) to authenticated;

-- 6. the price: what a payer would pay, and taking a use when a request is sent ----------------------------------------------------------------------------
-- The ONE place the discount is worked out. No row when the payer has no code, the code is paused, or all the lessons are used (live uses, not returned).
create or replace function public.promo_quote_row(p_profile uuid, p_list integer)
returns table (q_code_id uuid, q_percent integer, q_discount integer, q_pay integer, q_lesson integer, q_lessons integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.promo_codes;
  v_live integer;
  v_pay integer;
begin
  if p_list is null or p_list < 1 then
    return;
  end if;
  select pc.* into c from public.profiles p join public.promo_codes pc on pc.id = p.promo_code_id where p.id = p_profile and pc.active;
  if c.id is null then
    return;
  end if;
  select count(*) into v_live from public.promo_code_uses u where u.profile_id = p_profile and u.code_id = c.id and u.returned_at is null;
  if v_live >= c.uses_per_account then
    return;
  end if;
  v_pay := public.promo_paid_rand(p_list, c.percent_off);
  if p_list - v_pay < 1 then
    return;
  end if;
  return query select c.id, c.percent_off, p_list - v_pay, v_pay, v_live + 1, c.uses_per_account;
end;
$$;
revoke all on function public.promo_quote_row(uuid, integer) from public, anon, authenticated, service_role;

-- Takes a use for this request and returns the rand off (0 = no discount). The payer's profile row is locked, so requests sent at the same moment are counted
-- one after the other. Repeat calls for the same request change nothing. If the hold that follows is refused (a wallet too small), the whole call rolls back,
-- use included.
create or replace function public.promo_take_use(p_request uuid, p_payer uuid, p_list integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q record;
  v_existing integer;
begin
  perform 1 from public.profiles where id = p_payer for update;
  select amount_off into v_existing from public.promo_code_uses where request_id = p_request and returned_at is null;
  if found then
    return v_existing;
  end if;
  select * into q from public.promo_quote_row(p_payer, p_list);
  if q.q_code_id is null then
    return 0;
  end if;
  insert into public.promo_code_uses (code_id, profile_id, request_id, percent_off, list_rand, amount_off, lesson_number)
  values (q.q_code_id, p_payer, p_request, q.q_percent, p_list, q.q_discount, q.q_lesson);
  return q.q_discount;
end;
$$;
revoke all on function public.promo_take_use(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- What the booking screen shows BEFORE the request is sent: "10% code applied: R252 (lesson 1 of 3)". Asks about the caller's own account only, and works out the
-- same numbers send_request_wallet will use.
create or replace function public.my_promo_quote(p_list_rand integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q record;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into q from public.promo_quote_row(auth.uid(), p_list_rand);
  if q.q_code_id is null then
    return jsonb_build_object('applies', false);
  end if;
  return jsonb_build_object('applies', true, 'percent', q.q_percent, 'list_rand', p_list_rand, 'discount_rand', q.q_discount, 'pay_rand', q.q_pay,
                            'lesson_number', q.q_lesson, 'lessons', q.q_lessons);
end;
$$;
revoke all on function public.my_promo_quote(integer) from public, anon;
grant execute on function public.my_promo_quote(integer) to authenticated;

-- 7. a use comes back when the lesson does not happen; a use is tied to its session ---------------------------------------------------------------------
create or replace function public.promo_return_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promo_code_uses
     set returned_at = now(), returned_reason = left(new.status || ' / ' || new.payment_status, 200)
   where request_id = new.id and returned_at is null;
  return new;
end;
$$;
revoke all on function public.promo_return_use() from public, anon, authenticated, service_role;
drop trigger if exists promo_return_use on public.session_requests;
create trigger promo_return_use after update of status, payment_status on public.session_requests
  for each row when (new.promo_discount_rand > 0 and (new.status in ('expired', 'declined', 'cancelled') or new.payment_status = 'wallet_refunded'))
  execute function public.promo_return_use();

create or replace function public.promo_use_link_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.promo_code_uses set session_id = new.resulting_session_id where request_id = new.id and session_id is null;
  return new;
end;
$$;
revoke all on function public.promo_use_link_session() from public, anon, authenticated, service_role;
drop trigger if exists promo_use_link_session on public.session_requests;
create trigger promo_use_link_session after update of resulting_session_id on public.session_requests
  for each row when (new.promo_discount_rand > 0 and new.resulting_session_id is not null and old.resulting_session_id is distinct from new.resulting_session_id)
  execute function public.promo_use_link_session();

-- 8. the finance admin's functions ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_create_promo_code(p_code text, p_label text, p_percent integer, p_uses integer, p_valid_from timestamptz,
                                                          p_valid_until timestamptz, p_max_families integer, p_tutor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.promo_normalise(p_code);
  v_id uuid;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if v_norm is null then
    raise exception 'A code is 3 to 32 letters, digits, - or _ (no spaces).' using errcode = '22023';
  end if;
  if coalesce(p_percent, 10) not between 1 and 30 then
    raise exception 'The percent off is between 1 and 30.' using errcode = '22023';
  end if;
  if coalesce(p_uses, 3) not between 1 and 20 then
    raise exception 'The number of lessons per account is between 1 and 20.' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until <= coalesce(p_valid_from, now()) then
    raise exception 'The end date has to be after the start.' using errcode = '22023';
  end if;
  if p_max_families is not null and p_max_families < 1 then
    raise exception 'The cap of families has to be at least 1, or left empty for no cap.' using errcode = '22023';
  end if;
  if p_tutor is not null and not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'That tutor does not exist.' using errcode = '22023';
  end if;
  begin
    insert into public.promo_codes (code, label, percent_off, uses_per_account, valid_from, valid_until, max_families, referring_tutor_id, created_by)
    values (v_norm, btrim(coalesce(p_label, '')), coalesce(p_percent, 10), coalesce(p_uses, 3), coalesce(p_valid_from, now()), p_valid_until, p_max_families,
            p_tutor, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That code already exists.' using errcode = '23505';
  end;
  perform public.log_admin_event('promo_code_created', 'promo_code', v_id,
    jsonb_build_object('code', v_norm, 'percent_off', coalesce(p_percent, 10), 'uses_per_account', coalesce(p_uses, 3), 'max_families', p_max_families,
                       'referring_tutor_id', p_tutor));
  return v_id;
end;
$$;
revoke all on function public.admin_create_promo_code(text, text, integer, integer, timestamptz, timestamptz, integer, uuid) from public, anon;
grant execute on function public.admin_create_promo_code(text, text, integer, integer, timestamptz, timestamptz, integer, uuid) to authenticated;

-- Edits every field but the code itself. The new values apply to lessons requested from now on; a request already sent keeps what it was told.
create or replace function public.admin_update_promo_code(p_id uuid, p_label text, p_percent integer, p_uses integer, p_valid_from timestamptz,
                                                          p_valid_until timestamptz, p_max_families integer, p_tutor uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.promo_codes;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into o from public.promo_codes where id = p_id for update;
  if not found then
    raise exception 'No such code.' using errcode = 'P0002';
  end if;
  if p_percent not between 1 and 30 then
    raise exception 'The percent off is between 1 and 30.' using errcode = '22023';
  end if;
  if p_uses not between 1 and 20 then
    raise exception 'The number of lessons per account is between 1 and 20.' using errcode = '22023';
  end if;
  if p_valid_from is null or (p_valid_until is not null and p_valid_until <= p_valid_from) then
    raise exception 'The end date has to be after the start.' using errcode = '22023';
  end if;
  if p_max_families is not null and p_max_families < 1 then
    raise exception 'The cap of families has to be at least 1, or left empty for no cap.' using errcode = '22023';
  end if;
  if p_tutor is not null and not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'That tutor does not exist.' using errcode = '22023';
  end if;
  update public.promo_codes
     set label = btrim(coalesce(p_label, '')), percent_off = p_percent, uses_per_account = p_uses, valid_from = p_valid_from, valid_until = p_valid_until,
         max_families = p_max_families, referring_tutor_id = p_tutor, active = coalesce(p_active, o.active)
   where id = p_id;
  perform public.log_admin_event('promo_code_changed', 'promo_code', p_id,
    jsonb_build_object('code', o.code,
                       'was', jsonb_build_object('percent_off', o.percent_off, 'uses_per_account', o.uses_per_account, 'valid_until', o.valid_until,
                                                 'max_families', o.max_families, 'active', o.active, 'referring_tutor_id', o.referring_tutor_id),
                       'now', jsonb_build_object('percent_off', p_percent, 'uses_per_account', p_uses, 'valid_until', p_valid_until,
                                                 'max_families', p_max_families, 'active', coalesce(p_active, o.active), 'referring_tutor_id', p_tutor)));
end;
$$;
revoke all on function public.admin_update_promo_code(uuid, text, integer, integer, timestamptz, timestamptz, integer, uuid, boolean) from public, anon;
grant execute on function public.admin_update_promo_code(uuid, text, integer, integer, timestamptz, timestamptz, integer, uuid, boolean) to authenticated;

create or replace function public.admin_set_promo_code_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.promo_codes;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into o from public.promo_codes where id = p_id for update;
  if not found then
    raise exception 'No such code.' using errcode = 'P0002';
  end if;
  update public.promo_codes set active = coalesce(p_active, o.active) where id = p_id;
  perform public.log_admin_event('promo_code_changed', 'promo_code', p_id,
    jsonb_build_object('code', o.code, 'was', jsonb_build_object('active', o.active), 'now', jsonb_build_object('active', coalesce(p_active, o.active))));
end;
$$;
revoke all on function public.admin_set_promo_code_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_promo_code_active(uuid, boolean) to authenticated;

-- "I forgot to enter it": attach a code to an existing parent or learner account, found by e-mail. An active code only (the dates and the cap are the admin's
-- call here). An account that has already had lessons at a different code's price is refused, so nobody is switched mid-way.
create or replace function public.admin_attach_promo_code(p_email text, p_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.promo_normalise(p_code);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  p record;
  c public.promo_codes;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 300 then
    raise exception 'A written reason is needed (5 to 300 characters).' using errcode = '22023';
  end if;
  if v_norm is null then
    raise exception 'That is not the shape of a code.' using errcode = '22023';
  end if;
  select * into c from public.promo_codes where upper(code) = v_norm;
  if not found or not c.active then
    raise exception 'There is no active code with that name.' using errcode = 'P0002';
  end if;
  select id, role::text as role, promo_code_id into p from public.profiles where lower(email) = lower(btrim(coalesce(p_email, '')));
  if not found then
    raise exception 'No account has that e-mail address.' using errcode = 'P0002';
  end if;
  if p.role not in ('parent', 'student') then
    raise exception 'Codes go on parent and learner accounts.' using errcode = '22023';
  end if;
  if p.promo_code_id = c.id then
    return jsonb_build_object('attached', true, 'already', true);
  end if;
  if p.promo_code_id is not null and exists (select 1 from public.promo_code_uses u where u.profile_id = p.id and u.returned_at is null) then
    raise exception 'This account has already had lessons at another code''s price.' using errcode = '55000';
  end if;
  update public.profiles set promo_code_id = c.id, promo_code_entered = c.code, promo_attached_at = now(), promo_attached_by = auth.uid() where id = p.id;
  perform public.log_admin_event('promo_code_attached', 'profile', p.id,
    jsonb_build_object('code', c.code, 'previous_code_id', p.promo_code_id, 'reason', v_reason));
  return jsonb_build_object('attached', true, 'already', false);
end;
$$;
revoke all on function public.admin_attach_promo_code(text, text, text) from public, anon;
grant execute on function public.admin_attach_promo_code(text, text, text) to authenticated;

-- The Codes page in one call: every code with its sign-ups, lessons and rand. "Booked" = a lesson that carries the discount and has not been returned;
-- "taken" = the same once the session was completed (the money the discount really cost).
create or replace function public.admin_list_promo_codes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
    from (
      select c.id, c.code, c.label, c.percent_off, c.uses_per_account, c.valid_from, c.valid_until, c.max_families, c.active, c.referring_tutor_id,
             (select nullif(btrim(coalesce(pr.full_name, '')), '') from public.profiles pr where pr.id = c.referring_tutor_id) as referring_tutor_name,
             c.created_at,
             (select count(*) from public.profiles p where p.promo_code_id = c.id)::integer as signups,
             (select count(*) from public.promo_code_uses u where u.code_id = c.id and u.returned_at is null)::integer as lessons_booked,
             (select count(*) from public.promo_code_uses u join public.session_requests r on r.id = u.request_id join public.sessions s on s.id = r.resulting_session_id
               where u.code_id = c.id and u.returned_at is null and s.status = 'completed')::integer as lessons_completed,
             (select count(*) from public.promo_code_uses u where u.code_id = c.id and u.returned_at is not null)::integer as lessons_returned,
             coalesce((select sum(u.amount_off) from public.promo_code_uses u where u.code_id = c.id and u.returned_at is null), 0)::integer as rand_booked,
             coalesce((select sum(u.amount_off) from public.promo_code_uses u join public.session_requests r on r.id = u.request_id join public.sessions s on s.id = r.resulting_session_id
                        where u.code_id = c.id and u.returned_at is null and s.status = 'completed'), 0)::integer as rand_given
        from public.promo_codes c
    ) t), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_promo_codes() from public, anon;
grant execute on function public.admin_list_promo_codes() to authenticated;

-- 9. THE REPLACED FUNCTIONS, PATCHED IN PLACE ----------------------------------------------------------------------------------------------------------
-- Same method as 20261102210000_wallet_booking.sql: each function is read from the database as it is now (pg_get_functiondef), the anchor is checked to occur
-- exactly the stated number of times (otherwise this migration stops and changes nothing), it is replaced, and the function is recreated with the same
-- attributes and rights. A function whose text already holds the patch's marker is left alone, so a re-run is a no-op.
create or replace function pg_temp.promo_patch(p_sig regprocedure, p_marker text, p_anchor text, p_new text, p_expect integer default 1)
returns text
language plpgsql
as $patch$
declare
  d text;
  n integer;
begin
  d := replace(pg_get_functiondef(p_sig), chr(13), '');
  if strpos(d, p_marker) > 0 then
    return p_sig::text || ': already patched (' || p_marker || ')';
  end if;
  n := (length(d) - length(replace(d, p_anchor, ''))) / length(p_anchor);
  if n <> p_expect then
    raise exception 'promo codes patch: the anchor was found % time(s) in %, expected % (%)', n, p_sig, p_expect, p_marker;
  end if;
  execute replace(d, p_anchor, p_new);
  return p_sig::text || ': patched (' || p_marker || ')';
end;
$patch$;

-- Sign-up: the code typed (or carried by the link) travels in the sign-up metadata as signup_code, so it survives the e-mail confirmation step. A problem with a
-- code never blocks a sign-up.
select pg_temp.promo_patch(
  'public.handle_new_user_role_expansion()'::regprocedure,
  'PROMO CODES signup (CEO, 5 Nov 2026)',
  'return new;',
  $blk$-- PROMO CODES signup (CEO, 5 Nov 2026): attach the code the person arrived with (parent and learner accounts only). Never blocks the sign-up.
  begin
    perform public.promo_attach_at_signup(new.id, v_role::text, new.raw_user_meta_data->>'signup_code');
  exception when others then
    null;
  end;

  return new;$blk$);

-- send_request_wallet: the use is taken and the hold is the discounted price
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO CODES send 1 (CEO, 5 Nov 2026)',
  'v_avail integer;',
  $blk$v_avail integer;
  v_discount integer := 0;  /* PROMO CODES send 1 (CEO, 5 Nov 2026) */$blk$);
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO CODES send 2 (CEO, 5 Nov 2026)',
  'perform public.wallet_hold_for_request(v_req.id, v_uid, v_amount);',
  $blk$-- PROMO CODES send 2 (CEO, 5 Nov 2026): a payer with a code takes one use; the hold is the price less the discount. A wallet too small still refuses with the shortfall
  -- (of the discounted price) and the use is rolled back with it.
  v_discount := public.promo_take_use(v_req.id, v_uid, v_amount);
  perform public.wallet_hold_for_request(v_req.id, v_uid, v_amount - v_discount);$blk$);
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO CODES send 3 (CEO, 5 Nov 2026)',
  'wallet_hold_rand = v_amount where id = v_req.id;',
  $blk$wallet_hold_rand = v_amount - v_discount, promo_discount_rand = v_discount /* PROMO CODES send 3 (CEO, 5 Nov 2026) */ where id = v_req.id;$blk$);
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO CODES send 5 (CEO, 5 Nov 2026)',
  '''held_rand'', v_req.wallet_hold_rand, ''already'', true);',
  $blk$'held_rand', v_req.wallet_hold_rand, 'discount_rand', coalesce(v_req.promo_discount_rand, 0), 'already', true); /* PROMO CODES send 5 (CEO, 5 Nov 2026) */$blk$);
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO CODES send 4 (CEO, 5 Nov 2026)',
  '''held_rand'', v_amount, ''available_rand'', v_avail, ''already'', false);',
  $blk$'held_rand', v_amount - v_discount, 'discount_rand', v_discount, 'available_rand', v_avail, 'already', false); /* PROMO CODES send 4 (CEO, 5 Nov 2026) */$blk$);

-- resend_request_without_card: "send to anyone" makes a new request with a new hold; the first request's use went back when it ended, so this one takes its own
select pg_temp.promo_patch(
  'public.resend_request_without_card(uuid)'::regprocedure,
  'PROMO CODES resend 1 (CEO, 5 Nov 2026)',
  'v_amount integer;',
  $blk$v_amount integer;
  v_discount integer := 0;  /* PROMO CODES resend 1 (CEO, 5 Nov 2026) */$blk$);
select pg_temp.promo_patch(
  'public.resend_request_without_card(uuid)'::regprocedure,
  'PROMO CODES resend 2 (CEO, 5 Nov 2026)',
  'perform public.wallet_hold_for_request(v_new, v_req.requested_by_profile_id, v_amount);',
  $blk$-- PROMO CODES resend 2 (CEO, 5 Nov 2026): the new request takes its own use (if the payer still has one) and is held at the discounted price.
    v_discount := public.promo_take_use(v_new, v_req.requested_by_profile_id, v_amount);
    if v_discount > 0 then
      update public.session_requests set wallet_hold_rand = v_amount - v_discount, promo_discount_rand = v_discount where id = v_new;
    end if;
    perform public.wallet_hold_for_request(v_new, v_req.requested_by_profile_id, v_amount - v_discount);$blk$);

-- create_wallet_session: the payer's hold (what was paid) becomes the session's gross; the TUTOR'S SHARE IS WORKED ON THE PRICE BEFORE THE DISCOUNT
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 1 (CEO, 5 Nov 2026)',
  'v_price integer;',
  $blk$v_price integer;
  v_list integer;  /* PROMO CODES session 1 (CEO, 5 Nov 2026) */$blk$);
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 2 (CEO, 5 Nov 2026)',
  'v_price := v_req.wallet_hold_rand;',
  $blk$v_price := v_req.wallet_hold_rand;   -- what the payer paid
  v_list := v_price + coalesce(v_req.promo_discount_rand, 0);   -- the level price before any discount; PROMO CODES session 2 (CEO, 5 Nov 2026)$blk$);
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 3 (CEO, 5 Nov 2026)',
  'v_comm := round(v_price * v_pct / 100)::integer;',
  $blk$v_comm := round(v_list * v_pct / 100)::integer;   /* PROMO CODES session 3 (CEO, 5 Nov 2026): commission on the price before the discount */$blk$);
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 4 (CEO, 5 Nov 2026)',
  'v_price, v_price - v_comm, v_req.requested_start,',
  $blk$v_price, v_list - v_comm /* PROMO CODES session 4 (CEO, 5 Nov 2026): the tutor's pay is unchanged by a code */, v_req.requested_start,$blk$);
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 5 (CEO, 5 Nov 2026)',
  'currency_code, status, wallet_paid',
  $blk$currency_code, status, wallet_paid, promo_discount_rand /* PROMO CODES session 5 (CEO, 5 Nov 2026) */$blk$);
select pg_temp.promo_patch(
  'public.create_wallet_session(uuid, uuid, integer)'::regprocedure,
  'PROMO CODES session 6 (CEO, 5 Nov 2026)',
  'v_req.currency_code, ''scheduled'', true',
  $blk$v_req.currency_code, 'scheduled', true, coalesce(v_req.promo_discount_rand, 0) /* PROMO CODES session 6 (CEO, 5 Nov 2026) */$blk$);

-- wallet_credit_tutor: the stored split still has to add up; with a discount the tutor's share is the price before the discount less the commission
select pg_temp.promo_patch(
  'public.wallet_credit_tutor()'::regprocedure,
  'PROMO CODES credit (CEO, 5 Nov 2026)',
  'r.wallet_hold_rand - r.commission_amount',
  $blk$r.wallet_hold_rand + coalesce(r.promo_discount_rand, 0) - r.commission_amount /* PROMO CODES credit (CEO, 5 Nov 2026) */$blk$);

-- the "back in your wallet" notices say what actually went back (the amount held), not the price before the discount
select pg_temp.promo_patch(
  'public.expire_stale_paid_requests()'::regprocedure,
  'PROMO CODES expiry 1 (CEO, 5 Nov 2026)',
  'paid_from_wallet, charged_amount /* WALLET BOOKING expiry 1 (CEO, 2 Nov 2026) */ from public.session_requests',
  $blk$paid_from_wallet, wallet_hold_rand, charged_amount /* WALLET BOOKING expiry 1 (CEO, 2 Nov 2026) PROMO CODES expiry 1 (CEO, 5 Nov 2026) */ from public.session_requests$blk$);
select pg_temp.promo_patch(
  'public.expire_stale_paid_requests()'::regprocedure,
  'PROMO CODES expiry 2 (CEO, 5 Nov 2026)',
  'round(req.charged_amount)',
  $blk$coalesce(req.wallet_hold_rand, round(req.charged_amount)) /* PROMO CODES expiry 2 (CEO, 5 Nov 2026) */$blk$,
  2);
select pg_temp.promo_patch(
  'public.decline_session_request(uuid)'::regprocedure,
  'PROMO CODES decline (CEO, 5 Nov 2026)',
  'round(v_req.charged_amount)',
  $blk$coalesce(v_req.wallet_hold_rand, round(v_req.charged_amount)) /* PROMO CODES decline (CEO, 5 Nov 2026) */$blk$);
