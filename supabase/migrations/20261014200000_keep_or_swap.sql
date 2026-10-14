-- Master 7aa + 7da + 7db: "keep or swap" (the CEO's principle of 14 Oct 2026, and the CEO's answers the same day: all five defaults,
-- with a 48-hour window for a request addressed to a kept tutor).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--  * After a session, the learner (or the parent who looks after them) can KEEP the tutor or TRY SOMEONE ELSE. "Keep" lets them send a
--    request ADDRESSED to that tutor ("book again"). "Try someone else" means that tutor never sees that learner's requests again
--    until the learner undoes it. The tutor is not told.
--  * A tutor may end a pairing privately; the learner gets a neutral note and can still send requests to anyone.
--  * A request addressed to a tutor waits at most 48 hours, and never past 30 minutes after its session time. If the tutor does not
--    accept (or says they cannot), nothing is charged and the learner can send the same request to any available tutor in one tap
--    (the card is not checked again). The tutor is reminded after 24 hours.
--  * 7db (privacy): until now ANY signed-in account could read every waiting request (the learner's id, who asked, the Paystack
--    reference, the card record id and the amount). That open policy is REMOVED. A tutor now sees waiting requests only through a
--    function that returns just what a tutor needs, and applies the rules above.
--
-- WHAT THIS REPLACES (listed to the CEO before it was applied):
--  1. function guard_session_request_insert()        (the trigger that sets the price and resets money fields on a new request):
--     same checks as before, plus: it validates a request addressed to a tutor, and resets the new columns.
--  2. function claim_session_request(uuid, uuid)      (what happens when a tutor accepts): same checks and same payment steps, plus:
--     a request addressed to another tutor, an expired one, and one between a learner and a tutor who are parted cannot be claimed.
--  3. function expire_stale_paid_requests()           (the job that runs every 5 minutes): same behaviour for ordinary requests; adds the
--     48-hour end for addressed requests, a different note for them, and the 24-hour reminder to the tutor.
--  4. policy "Tutors view unclaimed pending requests" on session_requests: DROPPED (the privacy gap, 7db).
--  Everything else is new: columns requested_tutor_id, expires_at, reminder_sent_at, resent_from on session_requests; tables
--  learner_tutor_choices and tutor_ended_pairings; functions set_tutor_choice, clear_tutor_choice, end_tutor_pairing,
--  resume_tutor_pairing, my_tutors, available_requests_for_tutor, decline_session_request, resend_request_to_anyone,
--  addressed_request_problem, pairing_blocked, notify_tutor_of_addressed_request; one trigger on session_requests.
--  NOT touched: record_card_verification, the payment code in server/index.ts, the price ladder, commissions, refunds.

-- ---- 1. new columns on session_requests ---------------------------------------------------------------------------------
alter table public.session_requests
  add column if not exists requested_tutor_id uuid references public.tutor_profiles (id) on delete cascade,
  add column if not exists expires_at timestamptz,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists resent_from uuid references public.session_requests (id) on delete set null;

-- A request can be sent on to anyone only once.
create unique index if not exists session_requests_resent_once on public.session_requests (resent_from) where resent_from is not null;
create index if not exists session_requests_addressed_pending on public.session_requests (requested_tutor_id)
  where requested_tutor_id is not null and status = 'pending';

-- ---- 2. the learner's choice, and a tutor's private ending ---------------------------------------------------------------
create table if not exists public.learner_tutor_choices (
  learner_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  choice text not null check (choice in ('keep', 'avoid')),
  chosen_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learner_id, tutor_id)
);

create table if not exists public.tutor_ended_pairings (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tutor_id, learner_id)
);

alter table public.learner_tutor_choices enable row level security;
alter table public.tutor_ended_pairings enable row level security;

-- A tutor can never read what learners chose about them; a learner can never read that a tutor ended a pairing.
drop policy if exists "Read own learner choices" on public.learner_tutor_choices;
create policy "Read own learner choices" on public.learner_tutor_choices
  for select to authenticated using (learner_id = auth.uid() or public.can_act_for_learner(learner_id));

drop policy if exists "Admins read learner choices" on public.learner_tutor_choices;
create policy "Admins read learner choices" on public.learner_tutor_choices
  for select to authenticated using (public.is_active_admin());

drop policy if exists "Tutors read own ended pairings" on public.tutor_ended_pairings;
create policy "Tutors read own ended pairings" on public.tutor_ended_pairings
  for select to authenticated using (tutor_id = auth.uid());

drop policy if exists "Admins read ended pairings" on public.tutor_ended_pairings;
create policy "Admins read ended pairings" on public.tutor_ended_pairings
  for select to authenticated using (public.is_active_admin());

revoke all on public.learner_tutor_choices from anon, authenticated;
revoke all on public.tutor_ended_pairings from anon, authenticated;
grant select on public.learner_tutor_choices to authenticated;
grant select on public.tutor_ended_pairings to authenticated;

-- ---- 3. one rule used everywhere: "are these two parted?" -------------------------------------------------------------------
-- True if the learner chose "try someone else" for this tutor, or the tutor ended the pairing. Only other database functions use it.
create or replace function public.pairing_blocked(p_learner uuid, p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.learner_tutor_choices where learner_id = p_learner and tutor_id = p_tutor and choice = 'avoid')
      or exists (select 1 from public.tutor_ended_pairings where learner_id = p_learner and tutor_id = p_tutor);
$$;

revoke all on function public.pairing_blocked(uuid, uuid) from public, anon, authenticated;

-- ---- 4. choosing -------------------------------------------------------------------------------------------------------------
create or replace function public.set_tutor_choice(p_learner uuid, p_tutor uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_choice is null or p_choice not in ('keep', 'avoid') then
    raise exception 'Choose to keep this tutor or to try someone else' using errcode = '22023';
  end if;
  -- The learner if they are an adult, or the person who looks after them. A learner under 18 with their own sign-in cannot.
  if p_learner is null or not public.can_book_for(p_learner) then
    raise exception 'Only the learner (if an adult) or the person who looks after them can choose' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sessions where student_id = p_learner and tutor_id = p_tutor and status = 'completed') then
    raise exception 'You can only choose about a tutor you have had a session with' using errcode = '42501';
  end if;

  insert into public.learner_tutor_choices (learner_id, tutor_id, choice, chosen_by)
  values (p_learner, p_tutor, p_choice, auth.uid())
  on conflict (learner_id, tutor_id)
  do update set choice = excluded.choice, chosen_by = excluded.chosen_by, updated_at = now();

  -- Trying someone else: whatever was waiting for that tutor is withdrawn (nothing was charged), so the learner decides what to do next.
  if p_choice = 'avoid' then
    update public.session_requests
       set status = 'cancelled', responded_at = now()
     where student_id = p_learner and requested_tutor_id = p_tutor and status = 'pending' and tutor_id is null;
  end if;
end;
$$;

create or replace function public.clear_tutor_choice(p_learner uuid, p_tutor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_learner is null or not public.can_book_for(p_learner) then
    raise exception 'Only the learner (if an adult) or the person who looks after them can choose' using errcode = '42501';
  end if;
  delete from public.learner_tutor_choices where learner_id = p_learner and tutor_id = p_tutor;
end;
$$;

-- A tutor ends a pairing privately. The learner gets a neutral note; whatever was waiting for this tutor is declined (nothing charged).
create or replace function public.end_tutor_pairing(p_learner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = auth.uid()) then
    raise exception 'Only tutors can do this' using errcode = '42501';
  end if;
  if p_learner is null or not exists (
    select 1 from public.sessions where student_id = p_learner and tutor_id = auth.uid() and status = 'completed'
  ) then
    raise exception 'You can only do this for a learner you have taught' using errcode = '42501';
  end if;

  insert into public.tutor_ended_pairings (tutor_id, learner_id) values (auth.uid(), p_learner)
  on conflict (tutor_id, learner_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return;  -- already ended: nothing to do, and the learner is not told twice
  end if;

  select split_part(btrim(coalesce(full_name, '')), ' ', 1) into v_first from public.profiles where id = auth.uid();

  update public.session_requests
     set status = 'declined', responded_at = now()
   where student_id = p_learner and requested_tutor_id = auth.uid() and status = 'pending' and tutor_id is null;

  -- The learner, and whoever booked their sessions with this tutor, hear it once, in neutral words.
  insert into public.notifications (profile_id, type, title, body)
  select distinct who.p, 'pairing_ended', 'Your tutor can''t carry on',
         coalesce(nullif(v_first, ''), 'Your tutor') || ' isn''t able to keep tutoring right now. You can send your next request to any available tutor; nothing is charged unless a tutor accepts.'
  from (
    select p_learner as p
    union
    select booked_by_profile_id from public.sessions where student_id = p_learner and tutor_id = auth.uid() and booked_by_profile_id is not null
  ) who
  where who.p is not null;
end;
$$;

create or replace function public.resume_tutor_pairing(p_learner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from public.tutor_ended_pairings where tutor_id = auth.uid() and learner_id = p_learner;
end;
$$;

-- ---- 5. is this addressed request allowed? (used by the insert guard; the caller must be allowed to book for the learner) ------
create or replace function public.addressed_request_problem(
  p_student uuid,
  p_requested_by uuid,
  p_tutor uuid,
  p_level text,
  p_enrollment uuid,
  p_institution uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tutor record;
  v_level_rate numeric;
  v_subject text;
begin
  -- Nobody can use this to find out about other people's learners and tutors.
  if auth.uid() is null or auth.uid() is distinct from p_requested_by or p_student is null or not public.can_book_for(p_student) then
    return 'You can''t send this request.';
  end if;

  select tp.id, tp.is_verified, tp.institution_id, st.max_allowed_rate as tutor_rate
    into v_tutor
    from public.tutor_profiles tp
    join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
   where tp.id = p_tutor;
  if not found or not coalesce(v_tutor.is_verified, false) then
    return 'That tutor can''t take this request right now. You can send it to any available tutor.';
  end if;
  if p_tutor = p_student or p_tutor = p_requested_by then
    return 'You can''t send a request to yourself.';
  end if;
  if not exists (select 1 from public.sessions where student_id = p_student and tutor_id = p_tutor and status = 'completed') then
    return 'You can only ask for a tutor you have had a session with.';
  end if;
  if exists (select 1 from public.learner_tutor_choices where learner_id = p_student and tutor_id = p_tutor and choice = 'avoid') then
    return 'You chose to try someone else instead of this tutor. Undo that under My tutors to ask for them again.';
  end if;
  if exists (select 1 from public.tutor_ended_pairings where learner_id = p_student and tutor_id = p_tutor) then
    return 'That tutor can''t take this request right now. You can send it to any available tutor.';
  end if;

  if p_level is not null then
    select max_allowed_rate into v_level_rate from public.sub_tier_definitions where id = p_level;
    if v_level_rate is not null and v_tutor.tutor_rate < v_level_rate then
      return 'This tutor teaches at a lower price level than the one you chose. Choose a lower level, or send the request to any available tutor.';
    end if;
  end if;

  if p_enrollment is not null then
    select subject_name into v_subject from public.student_subject_enrollments where id = p_enrollment;
    if v_subject is not null and not exists (
      select 1 from public.tutor_subject_competencies c
       where c.tutor_id = p_tutor and lower(c.subject_name) = lower(v_subject) and c.verification_status = 'verified'
    ) then
      return 'This tutor doesn''t teach that subject.';
    end if;
  end if;

  if p_institution is not null and v_tutor.institution_id is not null and p_institution <> v_tutor.institution_id then
    return 'This tutor works with a different institution.';
  end if;

  if (select count(*) from public.session_requests
       where requested_tutor_id = p_tutor and student_id = p_student and status = 'pending') >= 3 then
    return 'You already have 3 requests waiting for this tutor.';
  end if;

  return null;
end;
$$;

revoke all on function public.addressed_request_problem(uuid, uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.addressed_request_problem(uuid, uuid, uuid, text, uuid, uuid) to authenticated;

-- ---- 6. REPLACES guard_session_request_insert() ----------------------------------------------------------------------------------
create or replace function public.guard_session_request_insert()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_price numeric;
  v_currency text;
  v_tier integer;
  v_problem text;
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
  -- keep or swap: only this function sets these
  new.expires_at := null;
  new.reminder_sent_at := null;
  new.resent_from := null;

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

  -- A request addressed to a tutor the learner has had a session with ("book again").
  if new.requested_tutor_id is not null then
    v_problem := public.addressed_request_problem(
      new.student_id, new.requested_by_profile_id, new.requested_tutor_id,
      new.min_sub_tier_id, new.enrollment_id, new.institution_id
    );
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    -- At most 48 hours, and never later than the usual end (30 minutes after the session's start).
    new.expires_at := least(now() + interval '48 hours', new.requested_start + interval '30 minutes');
  end if;
  return new;
end;
$function$;

-- ---- 7. REPLACES claim_session_request(uuid, uuid) --------------------------------------------------------------------------------
create or replace function public.claim_session_request(p_request_id uuid, p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tutor record;
  v_req record;
  v_subject text;
  v_level_rate numeric;
  v_commission numeric;
  v_commission_amount numeric;
  v_card record;
  v_subaccount text;
  v_bearer text;
  v_reference text;
  v_session uuid;
begin
  if p_tutor_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = p_tutor_id;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests' using errcode = '42501';
  end if;

  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.tutor_id is not null or v_req.status <> 'pending'
     or v_req.payment_status not in ('paid', 'card_verified') then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  -- No self-matching (found 2026-10-05): a tutor account is an adult, so it can book for itself,
  -- and nothing stopped it accepting that same request. That would let a tutor buy hours and
  -- ratings towards a higher level. The tutor can never be the learner or the person who booked.
  if p_tutor_id = v_req.student_id or p_tutor_id = v_req.requested_by_profile_id then
    raise exception 'You can''t accept your own request.' using errcode = '42501';
  end if;

  -- Keep or swap: a request addressed to someone else, one past its end, and one between a learner and a tutor
  -- who are parted (the learner chose "try someone else", or the tutor ended the pairing) cannot be accepted.
  -- The words are the same for all three, so nobody learns why.
  if v_req.requested_tutor_id is not null and v_req.requested_tutor_id <> p_tutor_id then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;
  if v_req.expires_at is not null and v_req.expires_at <= now() then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;
  if public.pairing_blocked(v_req.student_id, p_tutor_id) then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate into v_level_rate from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  elsif v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
    raise exception 'This request is for a different pricing level.';
  end if;
  if v_req.institution_id is not null and v_tutor.institution_id is not null
     and v_req.institution_id <> v_tutor.institution_id then
    raise exception 'This request is for a different institution.';
  end if;
  if v_req.enrollment_id is not null then
    select subject_name into v_subject from public.student_subject_enrollments where id = v_req.enrollment_id;
    if v_subject is not null and not exists (
      select 1 from public.tutor_subject_competencies c
      where c.tutor_id = p_tutor_id and lower(c.subject_name) = lower(v_subject)
    ) then
      raise exception 'You don''t teach this subject yet.';
    end if;
  end if;

  v_commission := public.request_commission_pct(p_request_id, v_tutor.current_tier_id);
  if v_commission is null then
    raise exception 'No commission rate is set for this level — contact support';
  end if;
  v_commission_amount := round(v_req.charged_amount * v_commission / 100, 2);

  -- Paid up front under the old flow: book it without charging again.
  if v_req.payment_status = 'paid' then
    v_session := public.create_session_from_request(p_request_id, p_tutor_id, v_commission,
                                                    v_req.charged_amount - v_commission_amount);
    update public.session_requests set commission_amount = v_commission_amount where id = p_request_id;
    return jsonb_build_object('mode', 'already_paid', 'session_id', v_session);
  end if;

  select paystack_subaccount_code into v_subaccount
  from public.tutor_payout_accounts where tutor_id = p_tutor_id;
  if v_subaccount is null then
    raise exception 'Add your bank details in your tutor account before accepting paid requests — that''s where your share is paid.';
  end if;

  select * into v_card from public.payment_cards where id = v_req.payment_card_id;
  if v_card.id is null or v_card.revoked_at is not null or not v_card.reusable then
    raise exception 'This request''s card can''t be charged any more — it has been withdrawn.';
  end if;

  select setting_value #>> '{}' into v_bearer from public.system_settings where setting_key = 'paystack_fee_bearer';
  if v_bearer is null or v_bearer not in ('account', 'subaccount') then
    raise exception 'Payments aren''t configured yet (paystack_fee_bearer) — contact support';
  end if;

  v_reference := 'chg_' || replace(gen_random_uuid()::text, '-', '');
  update public.session_requests
  set tutor_id = p_tutor_id, payment_status = 'charging', claimed_at = now(), charge_reference = v_reference,
      commission_amount = v_commission_amount, fee_bearer = v_bearer, charge_failure_reason = null,
      charge_check_request_id = null
  where id = p_request_id;

  return jsonb_build_object(
    'mode', 'charge',
    'charge_reference', v_reference,
    'authorization_code', v_card.authorization_code,
    'email', v_card.paystack_email,
    'amount_cents', round(v_req.charged_amount * 100)::bigint,
    'commission_cents', round(v_commission_amount * 100)::bigint,
    'currency', trim(v_req.currency_code),
    'subaccount', v_subaccount,
    'bearer', v_bearer
  );
end;
$function$;

-- ---- 8. REPLACES expire_stale_paid_requests() ---------------------------------------------------------------------------------------
create or replace function public.expire_stale_paid_requests()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req record;
  secret text;
  req_id bigint;
begin
  for req in
    select id, student_id, requested_by_profile_id, requested_tutor_id from public.session_requests
    where status = 'pending' and payment_status = 'card_verified'
      and (requested_start < now() - interval '30 minutes' or (expires_at is not null and expires_at <= now()))
    for update skip locked
  loop
    update public.session_requests set status = 'expired', responded_at = now() where id = req.id;
    insert into public.notifications (profile_id, type, title, body)
    select distinct p, 'request_expired',
           case when req.requested_tutor_id is null then 'No tutor was free in time' else 'Your tutor didn''t reply in time' end,
           case when req.requested_tutor_id is null
                then 'Nobody accepted your request before the session time, so it has expired. Your card was not charged.'
                else 'Your tutor didn''t accept in time, so the request has expired. Your card was not charged. You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'
           end
    from unnest(array[req.student_id, req.requested_by_profile_id]) as p
    where p is not null;
  end loop;

  -- A tutor with a request addressed to them is reminded once, after 24 hours, while it is still open.
  for req in
    select id, requested_tutor_id from public.session_requests
    where status = 'pending' and payment_status = 'card_verified' and tutor_id is null
      and requested_tutor_id is not null and reminder_sent_at is null
      and created_at <= now() - interval '24 hours'
      and (expires_at is null or expires_at > now())
    for update skip locked
  loop
    update public.session_requests set reminder_sent_at = now() where id = req.id;
    insert into public.notifications (profile_id, type, title, body)
    values (req.requested_tutor_id, 'request_for_you_reminder', 'A learner is still waiting for you',
            'A request addressed to you is still open. Open Teach to accept it, or say you can''t take it so the learner can ask someone else.');
  end loop;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if secret is null then
    raise notice 'paystack_secret_key not found in vault; skipping refund sweep';
    return;
  end if;

  for req in
    select id, paystack_reference
    from public.session_requests
    where status = 'pending'
      and payment_status = 'paid'
      and requested_start < now() - interval '30 minutes'
  loop
    select net.http_post(
      url := 'https://api.paystack.co/refund',
      headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('transaction', req.paystack_reference)
    ) into req_id;

    update public.session_requests
      set status = 'expired', payment_status = 'refund_pending', refund_request_id = req_id,
          refund_requested_at = now()
      where id = req.id;
  end loop;
end;
$function$;

-- ---- 9. 7db: what a tutor may see (REPLACES the open policy) ------------------------------------------------------------------------
drop policy if exists "Tutors view unclaimed pending requests" on public.session_requests;

create or replace function public.available_requests_for_tutor()
returns table (
  id uuid,
  requested_start timestamptz,
  duration_hours numeric,
  enrollment_id uuid,
  charged_amount numeric,
  currency_code text,
  institution_id uuid,
  subject_name text,
  grade_level text,
  tier_id integer,
  tier_name text,
  level_id text,
  level_commission_pct numeric,
  sent_to_you boolean,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select r.id,
         r.requested_start,
         r.duration_hours,
         r.enrollment_id,
         r.charged_amount,
         trim(r.currency_code)::text,
         r.institution_id,
         e.subject_name::text,
         e.grade_level::text,
         r.tier_id,
         t.public_name::text,
         r.min_sub_tier_id::text,
         s.commission_rate_pct,
         (r.requested_tutor_id is not null),
         r.expires_at
    from public.session_requests r
    join public.tutor_profiles tp on tp.id = auth.uid() and tp.is_verified
    join public.sub_tier_definitions ts on ts.id = tp.current_sub_tier_id
    left join public.student_subject_enrollments e on e.id = r.enrollment_id
    left join public.tier_definitions t on t.id = r.tier_id
    left join public.sub_tier_definitions s on s.id = r.min_sub_tier_id
   where r.tutor_id is null
     and r.status = 'pending'
     and r.payment_status in ('card_verified', 'paid')
     and (r.expires_at is null or r.expires_at > now())
     and (r.requested_tutor_id is null or r.requested_tutor_id = auth.uid())
     and r.student_id <> auth.uid()
     and r.requested_by_profile_id <> auth.uid()
     and not public.pairing_blocked(r.student_id, auth.uid())
     -- only what this tutor could actually accept (the same rules claim_session_request applies, so nobody is shown a request
     -- they would be refused): a level at or below theirs (older requests without a level: the same tier), the same
     -- institution (empty on either side matches), and a subject they teach.
     and (case when r.min_sub_tier_id is not null then s.max_allowed_rate <= ts.max_allowed_rate
               else r.tier_id is null or r.tier_id = tp.current_tier_id end)
     and (r.institution_id is null or tp.institution_id is null or r.institution_id = tp.institution_id)
     and (e.subject_name is null or exists (
            select 1 from public.tutor_subject_competencies c
             where c.tutor_id = tp.id and lower(c.subject_name) = lower(e.subject_name)))
   order by r.requested_start;
end;
$$;

revoke all on function public.available_requests_for_tutor() from public, anon;
grant execute on function public.available_requests_for_tutor() to authenticated;

-- ---- 10. a tutor declines a request addressed to them ----------------------------------------------------------------------------------
create or replace function public.decline_session_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.requested_tutor_id is distinct from auth.uid() or v_req.status <> 'pending' or v_req.tutor_id is not null then
    raise exception 'That request is no longer available.';
  end if;

  update public.session_requests set status = 'declined', responded_at = now() where id = p_request_id;
  insert into public.notifications (profile_id, type, title, body)
  select distinct p, 'request_declined', 'Your tutor can''t take this one',
         'They aren''t able to take this request. Your card was not charged. You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
end;
$$;

revoke all on function public.decline_session_request(uuid) from public, anon;
grant execute on function public.decline_session_request(uuid) to authenticated;

-- ---- 11. one tap: send it to any available tutor instead ---------------------------------------------------------------------------
-- A request still waiting becomes an ordinary one. One that expired or was declined is sent again as a new ordinary request, using
-- the card already checked for it (no second check), once, while its session time is still ahead. Returns the request now waiting.
create or replace function public.resend_request_to_anyone(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_card record;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.requested_by_profile_id is distinct from auth.uid() or not public.can_book_for(v_req.student_id) then
    raise exception 'You can''t send this request again.' using errcode = '42501';
  end if;
  if v_req.requested_tutor_id is null or v_req.tutor_id is not null or v_req.status not in ('pending', 'expired', 'declined')
     or v_req.payment_status <> 'card_verified' then
    raise exception 'This request can''t be sent to anyone else.';
  end if;
  if v_req.requested_start < now() + interval '15 minutes' then
    raise exception 'That time has passed. Choose a new time and send a new request.';
  end if;

  if v_req.status = 'pending' then
    update public.session_requests set requested_tutor_id = null, expires_at = null where id = v_req.id;
    return v_req.id;
  end if;

  if exists (select 1 from public.session_requests where resent_from = v_req.id) then
    raise exception 'You already sent this request to anyone else.';
  end if;
  select * into v_card from public.payment_cards where id = v_req.payment_card_id;
  if v_card.id is null or v_card.revoked_at is not null or not v_card.reusable then
    raise exception 'The card for this request can''t be used again. Send a new request.';
  end if;

  insert into public.session_requests (
    student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status,
    currency_code, institution_id, min_sub_tier_id, tier_id, charged_amount, payment_card_id, paystack_reference,
    card_check_refund_status, resent_from
  ) values (
    v_req.student_id, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.requested_start, v_req.duration_hours,
    'pending', 'card_verified', v_req.currency_code, v_req.institution_id, v_req.min_sub_tier_id, v_req.tier_id,
    v_req.charged_amount, v_req.payment_card_id, 'rs_' || replace(gen_random_uuid()::text, '-', ''),
    'carried over from the first request', v_req.id
  ) returning id into v_new;
  return v_new;
end;
$$;

revoke all on function public.resend_request_to_anyone(uuid) from public, anon;
grant execute on function public.resend_request_to_anyone(uuid) to authenticated;

-- ---- 12. "My tutors": who the learner has had, what they chose, and what is waiting ----------------------------------------------------
create or replace function public.my_tutors(p_learner uuid)
returns table (
  tutor_id uuid,
  first_name text,
  choice text,
  can_book_again boolean,
  sessions_together integer,
  last_session_at timestamptz,
  last_subject text,
  last_grade text,
  last_level_id text,
  last_institution_id uuid,
  request_id uuid,
  request_status text,
  request_expires_at timestamptz,
  request_start timestamptz,
  request_can_resend boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Only the learner (an adult) or the person who looks after them; anyone else gets nothing.
  if auth.uid() is null or p_learner is null or not public.can_book_for(p_learner) then
    return;
  end if;

  return query
  select tp.id,
         split_part(btrim(coalesce(pr.full_name, '')), ' ', 1)::text,
         c.choice::text,
         (coalesce(tp.is_verified, false)
            and not exists (select 1 from public.tutor_ended_pairings x where x.tutor_id = tp.id and x.learner_id = p_learner)),
         g.n,
         g.last_at,
         e.subject_name::text,
         e.grade_level::text,
         lr.min_sub_tier_id::text,
         lr.institution_id,
         rq.id,
         rq.status::text,
         rq.expires_at,
         rq.requested_start,
         (rq.id is not null
            and rq.status in ('pending', 'expired', 'declined')
            and rq.payment_status = 'card_verified'
            and rq.requested_start >= now() + interval '15 minutes'
            and not exists (select 1 from public.session_requests y where y.resent_from = rq.id)
            and exists (select 1 from public.payment_cards pc where pc.id = rq.payment_card_id and pc.revoked_at is null and pc.reusable))
    from (
      select s.tutor_id as t, count(*)::integer as n, max(s.scheduled_start) as last_at
        from public.sessions s
       where s.student_id = p_learner and s.status = 'completed'
       group by s.tutor_id
    ) g
    join public.tutor_profiles tp on tp.id = g.t
    join public.profiles pr on pr.id = tp.id
    left join public.learner_tutor_choices c on c.learner_id = p_learner and c.tutor_id = g.t
    left join lateral (
      select s2.id, s2.enrollment_id
        from public.sessions s2
       where s2.student_id = p_learner and s2.tutor_id = g.t and s2.status = 'completed'
       order by s2.scheduled_start desc
       limit 1
    ) ls on true
    left join public.student_subject_enrollments e on e.id = ls.enrollment_id
    left join lateral (
      select r.min_sub_tier_id, r.institution_id
        from public.session_requests r
       where r.resulting_session_id = ls.id
       limit 1
    ) lr on true
    left join lateral (
      select r.id, r.status, r.expires_at, r.requested_start, r.payment_status, r.payment_card_id
        from public.session_requests r
       where r.student_id = p_learner and r.requested_tutor_id = g.t
       order by r.created_at desc
       limit 1
    ) rq on true
   order by g.last_at desc;
end;
$$;

revoke all on function public.my_tutors(uuid) from public, anon;
grant execute on function public.my_tutors(uuid) to authenticated;

revoke all on function public.set_tutor_choice(uuid, uuid, text) from public, anon;
revoke all on function public.clear_tutor_choice(uuid, uuid) from public, anon;
revoke all on function public.end_tutor_pairing(uuid) from public, anon;
revoke all on function public.resume_tutor_pairing(uuid) from public, anon;
grant execute on function public.set_tutor_choice(uuid, uuid, text) to authenticated;
grant execute on function public.clear_tutor_choice(uuid, uuid) to authenticated;
grant execute on function public.end_tutor_pairing(uuid) to authenticated;
grant execute on function public.resume_tutor_pairing(uuid) to authenticated;

-- ---- 13. the tutor hears when a request is addressed to them (once the card check has passed) ------------------------------------------
create or replace function public.notify_tutor_of_addressed_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, type, title, body)
  values (new.requested_tutor_id, 'request_for_you', 'A learner asked for you again',
          'A learner you have taught sent a request addressed to you. You have up to 48 hours to accept it (never later than its session time). Open Teach to see it.');
  return null;
end;
$$;

revoke all on function public.notify_tutor_of_addressed_request() from public, anon, authenticated;

drop trigger if exists trg_notify_tutor_of_addressed_request on public.session_requests;
create trigger trg_notify_tutor_of_addressed_request
  after update of payment_status on public.session_requests
  for each row when (new.requested_tutor_id is not null and new.payment_status = 'card_verified' and old.payment_status is distinct from 'card_verified')
  execute function public.notify_tutor_of_addressed_request();
