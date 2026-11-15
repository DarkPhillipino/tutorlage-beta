-- TUTOR CODES AND THE 5 PERCENT TUTOR BONUS (CEO, 10 Nov 2026 night; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md D3 and sections 9 and 11, P-5 and P-6).
-- Apply AFTER the promo code migrations (20261105200000, 20261105200100, 20261105200200) and the wallet migrations: it patches two wallet functions in place.
-- ONE file, no new audit-action values (it reuses promo_code_created / promo_code_changed). With the switch off (the default) nothing about money behaves differently.
--
-- P-5 A PERSONAL CODE PER TUTOR
--   * A tutor's personal code is an ordinary promo code (10 percent off a family's first 3 lessons, from the plan's rule) whose new column owner_tutor_id names the tutor.
--     One per tutor (a unique index). It is made when the tutor is APPROVED (is_verified goes false -> true; switch tutor_personal_codes_auto, default on) or by the
--     admin button (admin_create_tutor_code with the tutor's chosen name; admin_make_missing_tutor_codes for every verified tutor without one). The name is the tutor's
--     chosen name (the founding-tutors form's "code name") when the admin passes it, else the tutor's first name, with a number added if it is taken.
--   * The link https://tutorlage.com/?code=NAME pre-fills at sign-up (src/main.tsx already reads ?code=; nothing new there). The Codes page already counts sign-ups,
--     lessons and rand given away per code; admin_list_promo_codes now adds the owner and the bonus figures.
--   * owner_tutor_id is NOT referring_tutor_id on purpose: the "first offer to the referring tutor" feature (promo_first_offer_minutes, switched OFF) keeps reading only
--     referring_tutor_id, so personal codes never switch it on by themselves.
-- P-6 THE TUTOR BONUS (a MONEY rule, switched OFF: system_settings tutor_bonus_enabled = false until the CEO says on)
--   * When a lesson is COMPLETED and paid from a wallet, and the family that paid joined with a tutor's personal code (profiles.promo_code_id on the payer), the code's
--     owner is credited tutor_bonus_percent (5) percent of the LIST price of the lesson (the level price before any discount), rounded to the nearest whole rand.
--   * Only for families that have COMPLETED a lesson (this lesson counts: the bonus is paid the moment it completes), only for tutor_bonus_months (12) months counted from the
--     family's first completed lesson, only while the code is active, never on a lesson that was not paid from a wallet (the old no-payment mode), never twice for a lesson (one row per session).
--   * It comes out of Tutorlage's share; the tutor's pay and the family's discount never change. THE PLATFORM FLOOR (PM's rule): the family's 10 percent is always
--     honoured, and the bonus is trimmed so Tutorlage keeps at least tutor_bonus_platform_floor_rand (R15) on the lesson. Tutorlage's keep on a lesson is gross_amount
--     (what the family paid) less tutor_payout_amount; the bonus is min(percent of list, keep - floor), never below 0. (So a lesson where Tutorlage already keeps R15 or
--     less, such as 1A, pays no bonus.) Worked at the live level rates, one hour:
--         2C  list R280  commission R73   first 3 lessons: family R252, keep R45  -> bonus R14, keep R31      after lesson 3: keep R73 -> bonus R14, keep R59
--         3A  list R400  commission R92   first 3 lessons: family R360, keep R52  -> bonus R20, keep R32      after lesson 3: keep R92 -> bonus R20, keep R72
--         4D  list R1,200 commission R156 first 3 lessons: family R1,080, keep R36 -> bonus R21 (R60 wanted), keep R15   after lesson 3: keep R156 -> bonus R60, keep R96
--   * Self-referral guard: no bonus if the code's owner is the paying parent, the learner or the booker, or has the same phone number as the paying parent (the lesson is
--     recorded with a zero bonus and the reason, so finance can see it). Optional switch tutor_bonus_only_when_they_teach (default off): pay only when the code's owner
--     is also the tutor who taught that lesson.
--   * Where it shows: a wallet ledger line on the owner's wallet (kind session_credit, key bonus:<session>, the note starts "Referral bonus"), a notification, and a row in
--     tutor_bonuses (the money record: list price, wanted, paid, whether trimmed, what Tutorlage kept, the family's first lesson). A finance refund after delivery with
--     "take back from the tutor" reduces the bonus by the same share (never below zero, never past the owner's available balance; a shortfall is recorded and told to finance).
--     A lesson that is cancelled before it is completed never paid a bonus, so there is nothing to give back.
-- PATCHES (each in place, anchor checked to occur exactly once, a marker makes a re-run a no-op): wallet_credit_tutor (pays the bonus after the tutor's own credit, in its
-- own block so it can never touch that credit), admin_refund_to_wallet (the take-back, in its own block so it can never block a refund).
-- Nothing is dropped. No existing row changes.

-- 0. settings (all but the first are read tolerantly: a missing or silly value means the default) ------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('tutor_bonus_enabled', 'false'::jsonb, 'The tutor bonus: a tutor whose personal code a family joined with is credited a share of that family''s lessons. OFF until the CEO says on.'),
  ('tutor_bonus_percent', '5'::jsonb, 'The tutor bonus, as a percent of the lesson''s LIST price (the level price before any discount). Between 0 and 20.'),
  ('tutor_bonus_months', '12'::jsonb, 'How many months the bonus runs, counted from the family''s first completed lesson. Between 1 and 60.'),
  ('tutor_bonus_platform_floor_rand', '15'::jsonb, 'The platform floor: the bonus is trimmed so Tutorlage keeps at least this many rand on the lesson (after the family''s discount). The family''s discount is never trimmed.'),
  ('tutor_bonus_only_when_they_teach', 'false'::jsonb, 'If true, the bonus is paid only when the code''s owner also taught the lesson. Default false: it is a referral bonus, paid whoever teaches the family.'),
  ('tutor_personal_codes_auto', 'true'::jsonb, 'If true, a personal code is made for a tutor the moment they are approved. An admin can always make one by hand on the Codes page.')
on conflict (setting_key) do nothing;

create or replace function public.tutor_bonus_num(p_key text, p_default numeric, p_min numeric, p_max numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  select nullif(s.setting_value #>> '{}', '')::numeric into v from public.system_settings s where s.setting_key = p_key;
  if v is null or v < p_min or v > p_max then
    return p_default;
  end if;
  return v;
exception when others then
  return p_default;
end;
$$;
revoke all on function public.tutor_bonus_num(text, numeric, numeric, numeric) from public, anon, authenticated, service_role;

create or replace function public.tutor_bonus_flag(p_key text, p_default boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  select lower(coalesce(s.setting_value #>> '{}', '')) into v from public.system_settings s where s.setting_key = p_key;
  if v in ('true', 'false') then
    return v = 'true';
  end if;
  return p_default;
exception when others then
  return p_default;
end;
$$;
revoke all on function public.tutor_bonus_flag(text, boolean) from public, anon, authenticated, service_role;

-- 1. the owner of a personal code, and the bonus record ---------------------------------------------------------------------------------------------------------
alter table public.promo_codes add column if not exists owner_tutor_id uuid references public.tutor_profiles (id) on delete set null;
create unique index if not exists promo_codes_one_per_tutor on public.promo_codes (owner_tutor_id) where owner_tutor_id is not null;

-- One row per COMPLETED lesson that was looked at for a bonus (paid, or held back with a reason). A money record kept like the wallet ledger: plain uuids, no cascade.
create table if not exists public.tutor_bonuses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  request_id uuid,
  tutor_id uuid not null,                       -- who was credited: the code's owner
  code_id uuid not null references public.promo_codes (id),
  payer_id uuid not null,                       -- the family's payer
  list_rand integer not null check (list_rand > 0),
  percent numeric(5, 2) not null,
  wanted_rand integer not null check (wanted_rand >= 0),     -- the percent of the list price, before the platform floor
  paid_rand integer not null check (paid_rand >= 0),
  trimmed boolean not null default false,       -- the platform floor cut it
  platform_keeps_rand integer not null,         -- what Tutorlage kept on the lesson after the family's discount AND this bonus
  first_lesson_at timestamptz not null,         -- the family's first completed lesson: the period starts here
  note text check (length(note) <= 200),        -- why nothing was paid, when nothing was
  paid_at timestamptz not null default now(),
  reversed_rand integer not null default 0 check (reversed_rand >= 0 and reversed_rand <= paid_rand),
  reversal_short_rand integer not null default 0 check (reversal_short_rand >= 0),
  constraint tutor_bonuses_session_key unique (session_id)
);
create index if not exists tutor_bonuses_tutor on public.tutor_bonuses (tutor_id);
create index if not exists tutor_bonuses_code on public.tutor_bonuses (code_id);
alter table public.tutor_bonuses enable row level security;
revoke all on public.tutor_bonuses from public, anon, authenticated, service_role;
drop policy if exists "Finance admins read tutor bonuses" on public.tutor_bonuses;
create policy "Finance admins read tutor bonuses" on public.tutor_bonuses for select to authenticated using (public.wallet_is_finance_admin());
grant select on public.tutor_bonuses to authenticated;
-- (a tutor never reads this table: it holds the family's id. A tutor sees their own ledger lines and my_tutor_code() below.)

-- 2. the bonus maths (one place, so the suite can test it on its own) ----------------------------------------------------------------------------------------------
create or replace function public.tutor_bonus_amount(p_list integer, p_platform_keeps integer, p_percent numeric, p_floor integer)
returns table (wanted integer, paid integer)
language sql
immutable
set search_path = public
as $$
  select x.w, greatest(0, least(x.w, p_platform_keeps - p_floor))
    from (select round(p_list::numeric * p_percent / 100)::integer as w) x;
$$;
revoke all on function public.tutor_bonus_amount(integer, integer, numeric, integer) from public, anon, authenticated, service_role;

-- 3. paying the bonus for one completed lesson -------------------------------------------------------------------------------------------------------------------
create or replace function public.tutor_bonus_pay(p_session uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s public.sessions;
  c public.promo_codes;
  v_payer uuid;
  v_owner uuid;
  v_pct numeric;
  v_months integer;
  v_floor integer;
  v_list integer;
  v_keeps integer;
  v_first timestamptz;
  v_when timestamptz;
  v_wanted integer := 0;
  v_paid integer := 0;
  v_note text;
  v_req uuid;
begin
  if not public.tutor_bonus_flag('tutor_bonus_enabled', false) then
    return 0;
  end if;
  select * into s from public.sessions where id = p_session;
  if not found or s.status <> 'completed' or not coalesce(s.wallet_paid, false) or coalesce(s.free_session, false) or s.gross_amount is null then
    return 0;
  end if;
  if exists (select 1 from public.tutor_bonuses b where b.session_id = p_session) then
    return 0;
  end if;
  v_payer := s.booked_by_profile_id;
  if v_payer is null then
    return 0;
  end if;
  -- the payer's code, if it is a tutor's personal code that is still active
  select pc.* into c from public.profiles p join public.promo_codes pc on pc.id = p.promo_code_id
   where p.id = v_payer and pc.owner_tutor_id is not null and pc.active;
  if c.id is null then
    return 0;
  end if;
  v_owner := c.owner_tutor_id;
  if public.tutor_bonus_flag('tutor_bonus_only_when_they_teach', false) and s.tutor_id is distinct from v_owner then
    return 0;
  end if;
  v_pct := public.tutor_bonus_num('tutor_bonus_percent', 5, 0, 20);
  v_months := public.tutor_bonus_num('tutor_bonus_months', 12, 1, 60)::integer;
  v_floor := public.tutor_bonus_num('tutor_bonus_platform_floor_rand', 15, 0, 100000)::integer;
  -- the family's first completed lesson starts the clock; this lesson counts
  v_when := coalesce(s.completed_at, now());
  select min(coalesce(x.completed_at, x.scheduled_start)) into v_first
    from public.sessions x where x.booked_by_profile_id = v_payer and x.status = 'completed' and x.wallet_paid and not coalesce(x.free_session, false);
  v_first := least(coalesce(v_first, v_when), v_when);
  if v_when > v_first + make_interval(months => v_months) then
    return 0;
  end if;
  select q.id into v_req from public.session_requests q where q.resulting_session_id = p_session limit 1;
  v_list := (s.gross_amount + coalesce(s.promo_discount_rand, 0))::integer;
  v_keeps := (s.gross_amount - s.tutor_payout_amount)::integer;
  select a.wanted, a.paid into v_wanted, v_paid from public.tutor_bonus_amount(v_list, v_keeps, v_pct, v_floor) a;
  -- self-referral guard: the owner is the payer, the learner or the booker, or shares the payer's phone number
  if v_owner in (v_payer, s.student_id)
     or exists (select 1 from public.profiles a join public.profiles b on b.id = v_payer
                 where a.id = v_owner
                   and length(right(regexp_replace(coalesce(a.phone_number, ''), '\D', '', 'g'), 9)) = 9
                   and right(regexp_replace(coalesce(a.phone_number, ''), '\D', '', 'g'), 9) = right(regexp_replace(coalesce(b.phone_number, ''), '\D', '', 'g'), 9)) then
    v_paid := 0;
    v_note := 'self-referral guard: the code''s owner is, or shares a phone number with, the family';
  end if;
  insert into public.tutor_bonuses (session_id, request_id, tutor_id, code_id, payer_id, list_rand, percent, wanted_rand, paid_rand, trimmed, platform_keeps_rand,
                                    first_lesson_at, note)
  values (p_session, v_req, v_owner, c.id, v_payer, v_list, v_pct, v_wanted, v_paid, (v_paid < v_wanted and v_note is null), v_keeps - v_paid, v_first,
          coalesce(v_note, case when v_paid < v_wanted then 'trimmed by the platform floor' end));
  if v_paid > 0 then
    perform public.wallet_post(v_owner, 'session_credit', v_paid, 0, 'bonus:' || p_session, null,
                               'Referral bonus: a family who joined with your code had a lesson', null, null);
    perform public.wallet_notify(v_owner, 'wallet_tutor_bonus', 'Bonus added to your wallet',
      format('R%s was added to your wallet: a family who joined with your code had a lesson.', v_paid));
  end if;
  return v_paid;
end;
$$;
revoke all on function public.tutor_bonus_pay(uuid) from public, anon, authenticated, service_role;

-- A finance refund after the lesson, with "take back from the tutor": the bonus shrinks by the same share as the refund, if the owner's wallet covers it.
create or replace function public.tutor_bonus_take_back(p_session uuid, p_refunded_total integer, p_price integer, p_take_back boolean, p_key uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b public.tutor_bonuses;
  v_target integer;
  v_reduce integer;
begin
  if not coalesce(p_take_back, false) or p_price is null or p_price < 1 then
    return 0;
  end if;
  select * into b from public.tutor_bonuses where session_id = p_session for update;
  if not found or b.paid_rand <= 0 then
    return 0;
  end if;
  v_target := round(least(p_refunded_total, p_price)::numeric * b.paid_rand / p_price)::integer;
  v_reduce := greatest(v_target - b.reversed_rand, 0);
  if v_reduce = 0 then
    return 0;
  end if;
  begin
    perform public.wallet_post(b.tutor_id, 'refund_reversal', -v_reduce, 0, 'adminbonusback:' || p_key, null,
                               'The family was refunded for the lesson this referral bonus was paid on', null, null);
    update public.tutor_bonuses set reversed_rand = reversed_rand + v_reduce where id = b.id;
    perform public.wallet_notify(b.tutor_id, 'wallet_adjusted', 'Your wallet was updated',
      format('R%s was taken from your wallet because a family was refunded for a lesson your referral bonus was paid on.', v_reduce));
    return v_reduce;
  exception when others then
    if sqlerrm <> 'wallet_too_low' then
      raise;
    end if;
    update public.tutor_bonuses set reversal_short_rand = reversal_short_rand + v_reduce where id = b.id;
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus could not be taken back',
      format('A family was refunded for session %s, but R%s of its referral bonus could not be taken back: the tutor''s wallet is too low. Settle it with them by hand.', p_session, v_reduce));
    return 0;
  end;
end;
$$;
revoke all on function public.tutor_bonus_take_back(uuid, integer, integer, boolean, uuid) from public, anon, authenticated, service_role;

-- 4. a personal code per tutor ------------------------------------------------------------------------------------------------------------------------------------
-- A name made into the shape of a code: capitals and digits only (accents folded), at most 20 characters, at least 3.
create or replace function public.tutor_code_candidate(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(v) >= 3 then v else v || 'TUTOR' end
    from (select left(regexp_replace(translate(upper(coalesce(p_name, '')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'AAAAAACEEEEIIIINOOOOOUUUUY'), '[^A-Z0-9]', '', 'g'), 20) as v) x;
$$;
revoke all on function public.tutor_code_candidate(text) from public, anon, authenticated, service_role;

-- The name the tutor chose for their code before they signed up (the founding-tutors form's "code name"), if the list can say. The list is built in its own migration;
-- until it can answer, nothing is known and the code is made from the tutor's first name.
create or replace function public.tutor_chosen_code_name(p_tutor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select null::text;
$$;
revoke all on function public.tutor_chosen_code_name(uuid) from public, anon, authenticated, service_role;

-- Makes (or returns) the tutor's personal code. p_chosen = a name the tutor or an admin picked: used exactly (cleaned to the shape of a code), refused if taken.
-- No name = the tutor's chosen name from the list if there is one, else the first name, with a number added if it is taken.
create or replace function public.create_tutor_personal_code(p_tutor uuid, p_chosen text, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_full text;
  v_base text;
  v_try text;
  v_id uuid;
  v_i integer := 0;
  v_strict boolean := nullif(btrim(coalesce(p_chosen, '')), '') is not null;
begin
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'That tutor does not exist.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tutor_personal_code:' || p_tutor::text, 0));
  select id into v_id from public.promo_codes where owner_tutor_id = p_tutor;
  if found then
    return v_id;
  end if;
  select nullif(btrim(coalesce(full_name, '')), '') into v_full from public.profiles where id = p_tutor;
  v_base := public.tutor_code_candidate(coalesce(nullif(btrim(coalesce(p_chosen, '')), ''), public.tutor_chosen_code_name(p_tutor), split_part(coalesce(v_full, 'Tutor'), ' ', 1)));
  loop
    v_try := case when v_i = 0 then v_base when v_i < 100 then left(v_base, 29) || v_i::text else left(v_base, 24) || floor(random() * 90000 + 10000)::integer::text end;
    if v_strict and v_i > 0 then
      raise exception 'The code % is taken. Pick another name.', v_base using errcode = '23505';
    end if;
    begin
      insert into public.promo_codes (code, label, owner_tutor_id, created_by)
      values (v_try, left('Tutor: ' || coalesce(v_full, 'unnamed'), 80), p_tutor, p_actor)
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      select id into v_id from public.promo_codes where owner_tutor_id = p_tutor;   -- a second call won the race for this tutor
      if found then
        return v_id;
      end if;
      v_i := v_i + 1;
    end;
  end loop;
end;
$$;
revoke all on function public.create_tutor_personal_code(uuid, text, uuid) from public, anon, authenticated, service_role;

-- Approval makes the code. A problem here must never block an approval.
create or replace function public.tutor_personal_code_on_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.tutor_bonus_flag('tutor_personal_codes_auto', true) then
    begin
      perform public.create_tutor_personal_code(new.id, null, null);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.tutor_personal_code_on_approved() from public, anon, authenticated, service_role;
drop trigger if exists trg_tutor_personal_code_on_approved on public.tutor_profiles;
create trigger trg_tutor_personal_code_on_approved after update of is_verified on public.tutor_profiles
  for each row when (new.is_verified and not coalesce(old.is_verified, false))
  execute function public.tutor_personal_code_on_approved();

-- The admin button: one tutor, optionally with the name they chose. Finance admins only; one audit row.
create or replace function public.admin_create_tutor_code(p_tutor uuid, p_chosen_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_id uuid;
  v_code text;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'That tutor does not exist.' using errcode = 'P0002';
  end if;
  select id, code into v_old, v_code from public.promo_codes where owner_tutor_id = p_tutor;
  if found then
    return jsonb_build_object('created', false, 'id', v_old, 'code', v_code);
  end if;
  v_id := public.create_tutor_personal_code(p_tutor, p_chosen_name, auth.uid());
  select code into v_code from public.promo_codes where id = v_id;
  perform public.log_admin_event('promo_code_created', 'promo_code', v_id,
    jsonb_build_object('code', v_code, 'personal', true, 'owner_tutor_id', p_tutor, 'by_hand', true));
  return jsonb_build_object('created', true, 'id', v_id, 'code', v_code);
end;
$$;
revoke all on function public.admin_create_tutor_code(uuid, text) from public, anon;
grant execute on function public.admin_create_tutor_code(uuid, text) to authenticated;

-- Every verified tutor who has no personal code yet (a catch-up after the migration, or after the switch was off). Returns how many were made.
create or replace function public.admin_make_missing_tutor_codes()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t record;
  v_made integer := 0;
  v_failed integer := 0;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  for t in select tp.id from public.tutor_profiles tp
            where tp.is_verified and not exists (select 1 from public.promo_codes c where c.owner_tutor_id = tp.id) loop
    begin
      perform public.create_tutor_personal_code(t.id, null, auth.uid());
      v_made := v_made + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  if v_made > 0 then
    perform public.log_admin_event('promo_code_created', 'promo_code', '00000000-0000-0000-0000-000000000000'::uuid,
      jsonb_build_object('personal', true, 'catch_up', true, 'made', v_made, 'failed', v_failed));
  end if;
  return jsonb_build_object('made', v_made, 'failed', v_failed);
end;
$$;
revoke all on function public.admin_make_missing_tutor_codes() from public, anon;
grant execute on function public.admin_make_missing_tutor_codes() to authenticated;

-- The tutor's own view: their code, how many families came with it, and (only once the CEO has switched the bonus on) what it has paid. No family is named.
create or replace function public.my_tutor_code()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.promo_codes;
  v_on boolean := public.tutor_bonus_flag('tutor_bonus_enabled', false);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.promo_codes where owner_tutor_id = auth.uid();
  if not found then
    return jsonb_build_object('has_code', false, 'bonus_on', v_on);
  end if;
  return jsonb_build_object(
    'has_code', true, 'code', c.code, 'active', c.active, 'percent', c.percent_off, 'lessons', c.uses_per_account, 'bonus_on', v_on,
    'bonus_percent', public.tutor_bonus_num('tutor_bonus_percent', 5, 0, 20), 'bonus_months', public.tutor_bonus_num('tutor_bonus_months', 12, 1, 60)::integer,
    'families', (select count(*) from public.profiles p where p.promo_code_id = c.id),
    'bonus_lessons', (select count(*) from public.tutor_bonuses b where b.code_id = c.id and b.paid_rand > 0),
    'bonus_rand', coalesce((select sum(b.paid_rand - b.reversed_rand) from public.tutor_bonuses b where b.code_id = c.id), 0));
end;
$$;
revoke all on function public.my_tutor_code() from public, anon;
grant execute on function public.my_tutor_code() to authenticated;

-- 5. the Codes page: the same list as before, plus the owner and the bonus figures ----------------------------------------------------------------------------
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
                        where u.code_id = c.id and u.returned_at is null and s.status = 'completed'), 0)::integer as rand_given,
             c.owner_tutor_id,
             (select nullif(btrim(coalesce(pr.full_name, '')), '') from public.profiles pr where pr.id = c.owner_tutor_id) as owner_tutor_name,
             (select count(*) from public.tutor_bonuses b where b.code_id = c.id and b.paid_rand > 0)::integer as bonus_lessons,
             coalesce((select sum(b.paid_rand - b.reversed_rand) from public.tutor_bonuses b where b.code_id = c.id), 0)::integer as bonus_rand_paid,
             coalesce((select sum(b.wanted_rand - b.paid_rand) from public.tutor_bonuses b where b.code_id = c.id), 0)::integer as bonus_rand_held_back
        from public.promo_codes c
    ) t), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_promo_codes() from public, anon;
grant execute on function public.admin_list_promo_codes() to authenticated;

-- 6. THE PATCHES (same method as the promo codes migration: read the live text, check the anchor count, replace, recreate; a marker makes a re-run a no-op) --------
create or replace function pg_temp.bonus_patch(p_sig regprocedure, p_marker text, p_anchor text, p_new text, p_expect integer default 1)
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
    raise exception 'tutor bonus patch: the anchor was found % time(s) in %, expected % (%)', n, p_sig, p_expect, p_marker;
  end if;
  execute replace(d, p_anchor, p_new);
  return p_sig::text || ': patched (' || p_marker || ')';
end;
$patch$;

-- wallet_credit_tutor: after the tutor's own credit (and its own error block), pay the code owner's bonus in a block of its own
select pg_temp.bonus_patch(
  'public.wallet_credit_tutor()'::regprocedure,
  'TUTOR BONUS credit (CEO, 10 Nov 2026)',
  'sqlerrm));',
  $blk$sqlerrm));
  end;
  -- TUTOR BONUS credit (CEO, 10 Nov 2026): the code owner's referral bonus, in a block of its own so a problem here can never touch the tutor's credit above
  begin
    perform public.tutor_bonus_pay(new.id);
  exception when others then
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus did not go through',
      format('Session %s was completed but its referral bonus could not be paid: %s', new.id, sqlerrm));$blk$);

-- admin_refund_to_wallet: with "take back from the tutor", the bonus paid on this lesson shrinks by the same share; never blocks the refund
select pg_temp.bonus_patch(
  'public.admin_refund_to_wallet(uuid, integer, text, boolean, uuid)'::regprocedure,
  'TUTOR BONUS refund (CEO, 10 Nov 2026)',
  $a$v_day := to_char(s.scheduled_start at time zone 'Africa/Johannesburg', 'FMDD FMMon');$a$,
  $blk$-- TUTOR BONUS refund (CEO, 10 Nov 2026): the referral bonus paid on this lesson is reduced by the same share, only with "take back from the tutor"; never blocks the refund
  begin
    perform public.tutor_bonus_take_back(p_session, v_done + p_amount, v_price, coalesce(p_take_back, false), p_key);
  exception when others then
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus could not be reduced',
      format('Session %s was refunded but its referral bonus could not be reduced: %s', p_session, sqlerrm));
  end;
  v_day := to_char(s.scheduled_start at time zone 'Africa/Johannesburg', 'FMDD FMMon');$blk$);
