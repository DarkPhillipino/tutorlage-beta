-- TUTOR BONUS, fix forward 1 (10 Nov 2026): the same-phone self-referral guard looked in the wrong place.
-- Found by the first rolled-back run of supabase/tests/tutor_codes_and_bonus.sql (T40, T41, T45, T47 failed for this one reason; the other 41 checks, including the whole costing table, passed).
-- At sign-up the phone number is written to parent_profiles.phone_number / student_profiles.phone_number, NOT to profiles.phone_number (handle_new_user_role_expansion inserts profiles without one),
-- and for a tutor it stays only in the sign-up data (auth.users.raw_user_meta_data). tutor_bonus_pay compared profiles.phone_number only, so it never saw a match.
-- This file adds tutor_bonus_phone(profile) (the last 9 digits of the first phone found: parent profile, learner profile, profile, sign-up data, auth phone) and replaces tutor_bonus_pay with the
-- same function using it: a code's owner whose number matches the paying parent's OR the learner's gets no bonus (recorded with the reason). Safe to re-run.
-- ALSO in this file (the code-name hook, not a bug fix): tutor_chosen_code_name(tutor) now reads the name the tutor chose on the founding-tutors form (Programmer A's table
-- founding_tutors_list: code_name, linked to the tutor by user_id) so the personal code made at approval uses it. It is TOLERANT: while that table does not exist, or the tutor has no
-- linked entry, or anything goes wrong, it answers null and the code is made from the tutor's first name as before.

create or replace function public.tutor_chosen_code_name(p_tutor uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if to_regclass('public.founding_tutors_list') is null then
    return null;
  end if;
  execute 'select nullif(btrim(code_name), '''') from public.founding_tutors_list where user_id = $1 order by created_at desc limit 1' into v using p_tutor;
  if v is null then
    -- not linked by account yet: match the form's lower-case e-mail key to the tutor's sign-in e-mail (profiles has no e-mail)
    execute 'select nullif(btrim(l.code_name), '''') from public.founding_tutors_list l join auth.users u on lower(btrim(u.email)) = l.email_key where u.id = $1 order by l.created_at desc limit 1' into v using p_tutor;
  end if;
  return v;
exception when others then
  return null;
end;
$$;
revoke all on function public.tutor_chosen_code_name(uuid) from public, anon, authenticated, service_role;

create or replace function public.tutor_bonus_phone(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when length(d) >= 9 then right(d, 9) end
    from (select regexp_replace(coalesce(
                   nullif(btrim((select pp.phone_number from public.parent_profiles pp where pp.id = p_profile)), ''),
                   nullif(btrim((select sp.phone_number from public.student_profiles sp where sp.id = p_profile)), ''),
                   nullif(btrim((select pr.phone_number from public.profiles pr where pr.id = p_profile)), ''),
                   nullif(btrim((select u.raw_user_meta_data ->> 'phone_number' from auth.users u where u.id = p_profile)), ''),
                   nullif(btrim((select u.phone from auth.users u where u.id = p_profile)), ''),
                   ''), '\D', '', 'g') as d) x;
$$;
revoke all on function public.tutor_bonus_phone(uuid) from public, anon, authenticated, service_role;

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
  v_phone text;
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
  -- self-referral guard: the owner is the payer or the learner, or shares a phone number with the paying parent or the learner
  v_phone := public.tutor_bonus_phone(v_owner);
  if v_owner in (v_payer, s.student_id)
     or (v_phone is not null and (v_phone = public.tutor_bonus_phone(v_payer) or v_phone = public.tutor_bonus_phone(s.student_id))) then
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
