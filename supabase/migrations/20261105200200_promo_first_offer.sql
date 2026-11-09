-- PROMO CODES, part 2: "REFERRING TUTOR GETS THE FIRST OFFER" (CEO's decision of 5 Nov 2026; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md 8.2).
-- Apply AFTER 20261105200100_promo_codes.sql (it patches what that file patched). A SEPARATE FILE ON PURPOSE: if the PM decides not to build this part, delete this
-- file and nothing else changes. With no code that names a tutor, nothing behaves differently.
-- SHIPS SWITCHED OFF (PM decision, 5 Nov 2026): the window is the setting promo_first_offer_minutes and 0 means off; the shipped default is 0, so after this file is applied every request
-- behaves exactly as today. The CEO turns it on with a typed yes once the first anchor tutor is verified (60 is the value to recommend), because his standing principle is that a learner
-- cannot pick the first tutor: this exception is his switch, not a default. Switching it off again opens every reserved request to everyone at once. No parent screen says anything about it.
--
-- THE RULE: a code can name a referring tutor (promo_codes.referring_tutor_id). A parent who signed up with that code sends their request(s) from the wallet as usual; while
-- the account has no booked lesson yet, the request is OFFERED TO THAT TUTOR FIRST for a window (setting promo_first_offer_minutes; 0 = off, the default; 60 recommended). During the window no other tutor sees
-- the request or can accept it; after it, or at once if the referring tutor could not take it, the normal best-fit order applies. After the first lesson keep-or-swap is unchanged.
--   * It applies only if the referring tutor CURRENTLY could accept the request (verified, level, police clearance, not a parted pairing, approved for the subject and grade, free at that
--     time). If she could not, nothing is reserved and everyone sees the request as today, so a request can never become invisible. It is checked every time, not once: if she becomes busy
--     during the window, the request opens.
--   * For her, the school and curriculum rules of the first 5 minutes are not asked (the family came because of her): she is treated as in the widened phase from the start.
--   * A request addressed to a tutor ("book again"), a resend ("send to anyone") and a request of an account that already has a booked lesson are never reserved.
--   * Her notice says only that "a family who signed up with your code" sent a request. No other tutor is told anything: the answer to a refused accept is the same plain sentence as for any
--     request that is taken.
--   * The one place tutor visibility is decided is request_fit_code (the queue, the claim and accept_session_request all ask it), so this is one clause there plus a column set by
--     send_request_wallet; the column can never be set by a signed-in user.
-- WHAT THIS ADDS: setting promo_first_offer_minutes; column session_requests.first_offer_tutor_id; promo_first_offer_interval, promo_first_offer_tutor, promo_first_offer_ready (internal);
--   trigger promo_notify_first_offer; guard_promo_flags (replaced: it now also guards the new column); PATCHES (in place, same method as the codes file) to send_request_wallet and
--   request_fit_code. Nothing is dropped; no existing row changes.

insert into public.system_settings (setting_key, setting_value, description) values
  ('promo_first_offer_minutes', '0'::jsonb,
   'Minutes a request from a family that came with a tutor''s code is offered to that tutor alone (when she could take it). 0 = OFF, the shipped default: every request behaves as today. The CEO turns it on with a typed yes; 60 is the recommended value. After the window, or at once if she could not take it, every fitting tutor sees it.')
on conflict (setting_key) do nothing;

alter table public.session_requests add column if not exists first_offer_tutor_id uuid references public.tutor_profiles (id) on delete set null;

-- Only the functions below set it: a signed-in user inserting a row gets null, and updating cannot change it (the same guard as the discount).
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
  if tg_table_name = 'session_requests' then
    new.first_offer_tutor_id := case when tg_op = 'INSERT' then null else old.first_offer_tutor_id end;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_promo_flags() from public, anon, authenticated, service_role;

-- The window: a number of minutes in the setting. 0 means OFF (the shipped default). Anything that is not a number, or is negative, also means off: a typing mistake can never open a window.
create or replace function public.promo_first_offer_interval()
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce(
    (select case when jsonb_typeof(s.setting_value) = 'number' and (s.setting_value #>> '{}')::numeric >= 0 then (s.setting_value #>> '{}')::numeric end
       from public.system_settings s where s.setting_key = 'promo_first_offer_minutes'),
    0)::float8) * interval '1 minute';
$$;
revoke all on function public.promo_first_offer_interval() from public, anon, authenticated, service_role;

-- Who, if anyone, a request is offered to first: the referring tutor of the payer's (active) code, for an ordinary request of an account with no booked lesson yet.
create or replace function public.promo_first_offer_tutor(p_payer uuid, p_request uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  r record;
begin
  -- switched off (window 0, the shipped default): nothing is ever reserved, and nothing is recorded that a later switch-on could act on
  if public.promo_first_offer_interval() <= interval '0' then
    return null;
  end if;
  select pc.referring_tutor_id into v_tutor
    from public.profiles p join public.promo_codes pc on pc.id = p.promo_code_id
   where p.id = p_payer and pc.active and pc.referring_tutor_id is not null;
  if v_tutor is null then
    return null;
  end if;
  select requested_tutor_id, resent_from, student_id, requested_by_profile_id into r from public.session_requests where id = p_request;
  if not found or r.requested_tutor_id is not null or r.resent_from is not null then
    return null;
  end if;
  if v_tutor in (r.student_id, r.requested_by_profile_id) then
    return null;
  end if;
  if exists (select 1 from public.session_requests q where q.requested_by_profile_id = p_payer and q.id <> p_request and q.resulting_session_id is not null) then
    return null;
  end if;
  return v_tutor;
end;
$$;
revoke all on function public.promo_first_offer_tutor(uuid, uuid) from public, anon, authenticated, service_role;

-- Could this tutor accept this request RIGHT NOW? The widened rule (verified, level, clearance, no parted pairing, approved for the subject and grade, free at that time),
-- worked out here and not through request_fit_code (which asks this function: no loop). The reservation holds only while this is true.
create or replace function public.promo_first_offer_ready(p_tutor uuid, p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.session_requests r
      join public.tutor_profiles tp on tp.id = p_tutor and tp.is_verified
      join public.sub_tier_definitions ts on ts.id = tp.current_sub_tier_id
      left join public.sub_tier_definitions s on s.id = r.min_sub_tier_id
      left join public.student_subject_enrollments e on e.id = r.enrollment_id
     where r.id = p_request and r.tutor_id is null and r.status = 'pending'
       and p_tutor not in (r.student_id, r.requested_by_profile_id)
       and (case when r.min_sub_tier_id is not null then s.max_allowed_rate <= ts.max_allowed_rate else r.tier_id is null or r.tier_id = tp.current_tier_id end)
       and public.police_clearance_problem(p_tutor) is null
       and not public.pairing_blocked(r.student_id, p_tutor)
       and public.tutor_qualify_problem(p_tutor, e.subject_name, e.grade_level, null, null) is null
       and public.tutor_free_problem(p_tutor, greatest(r.requested_start, now()), r.duration_hours, p_request) is null
  );
$$;
revoke all on function public.promo_first_offer_ready(uuid, uuid) from public, anon, authenticated, service_role;

-- The referring tutor is told once, when the request is sent (and only if she could take it).
create or replace function public.promo_notify_first_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.promo_first_offer_ready(new.first_offer_tutor_id, new.id) then
    insert into public.notifications (profile_id, type, title, body)
    values (new.first_offer_tutor_id, 'request_for_you', 'A family you invited sent a request',
            format('A family who signed up with your code has sent a request. It is offered to you first, for %s minutes; after that other tutors can see it too. Open Teach to accept it.',
                   round(extract(epoch from public.promo_first_offer_interval()) / 60)::integer));
  end if;
  return null;
end;
$$;
revoke all on function public.promo_notify_first_offer() from public, anon, authenticated, service_role;
drop trigger if exists promo_notify_first_offer on public.session_requests;
create trigger promo_notify_first_offer after update of first_offer_tutor_id on public.session_requests
  for each row when (new.first_offer_tutor_id is not null and old.first_offer_tutor_id is distinct from new.first_offer_tutor_id)
  execute function public.promo_notify_first_offer();

-- PATCHES, same method as 20261105200100_promo_codes.sql (the anchor must occur exactly the stated number of times or this file stops and changes nothing; a marker makes a re-run a no-op).
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
    raise exception 'promo first offer patch: the anchor was found % time(s) in %, expected % (%)', n, p_sig, p_expect, p_marker;
  end if;
  execute replace(d, p_anchor, p_new);
  return p_sig::text || ': patched (' || p_marker || ')';
end;
$patch$;

-- send_request_wallet: the column is set in the same update that makes the request a verified wallet request
select pg_temp.promo_patch(
  'public.send_request_wallet(uuid)'::regprocedure,
  'PROMO FIRST OFFER send (CEO, 5 Nov 2026)',
  'promo_discount_rand = v_discount /* PROMO CODES send 3 (CEO, 5 Nov 2026) */ where id = v_req.id;',
  $blk$promo_discount_rand = v_discount /* PROMO CODES send 3 (CEO, 5 Nov 2026) */, first_offer_tutor_id = public.promo_first_offer_tutor(v_uid, v_req.id) /* PROMO FIRST OFFER send (CEO, 5 Nov 2026) */ where id = v_req.id;$blk$);

-- request_fit_code: the ONE place tutor visibility is decided
select pg_temp.promo_patch(
  'public.request_fit_code(uuid, uuid)'::regprocedure,
  'PROMO FIRST OFFER fit 1 (CEO, 5 Nov 2026)',
  'r.created_at, r.resent_from,',
  $blk$r.created_at, r.resent_from, r.first_offer_tutor_id /* PROMO FIRST OFFER fit 1 (CEO, 5 Nov 2026) */,$blk$);
select pg_temp.promo_patch(
  'public.request_fit_code(uuid, uuid)'::regprocedure,
  'PROMO FIRST OFFER fit 2 (CEO, 5 Nov 2026)',
  'return ''no_request'';',
  $blk$return 'no_request';
  end if;
  -- PROMO FIRST OFFER fit 2 (CEO, 5 Nov 2026): while the window is open, a request that came with a tutor's code is for her alone, but only while she could take it herself.
  if v.first_offer_tutor_id is not null and v.first_offer_tutor_id <> p_tutor and v.resent_from is null
     and now() < v.created_at + public.promo_first_offer_interval()
     and public.promo_first_offer_ready(v.first_offer_tutor_id, p_request) then
    return 'reserved';$blk$);
select pg_temp.promo_patch(
  'public.request_fit_code(uuid, uuid)'::regprocedure,
  'PROMO FIRST OFFER fit 3 (CEO, 5 Nov 2026)',
  'if public.request_is_widened(v.requested_tutor_id, v.created_at, v.resent_from) then',
  $blk$if public.request_is_widened(v.requested_tutor_id, v.created_at, v.resent_from) or (v.first_offer_tutor_id = p_tutor and v.requested_tutor_id is null) /* PROMO FIRST OFFER fit 3 (CEO, 5 Nov 2026): for her, no school or curriculum rule */ then$blk$);
