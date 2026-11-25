-- A BOOKING FROM A TUTOR'S OWN PAGE IS CONFIRMED WITHOUT THE TUTOR ACCEPTING, WITH 24 HOURS' NOTICE (PM line 81 C, 25 Nov 2026; for page bookings only
-- this replaces line 79's rule). Every other request works as before. It applies to a tutor only after the tutor has accepted the Terms version named in
-- the setting page_confirm_since_terms_version (or a later one). Deleting that setting switches the whole thing off.
-- ONE step: confirm_page_booking runs AS THE FAMILY, so the insert passes the same row rule and insert checks as any request; finish_page_booking then
-- locks the tutor, checks again, holds the credit (send_request_wallet) and books exactly as an acceptance does (claim_session_request). Any refusal
-- undoes the whole call: no request, no hold, no lesson.
insert into public.system_settings (setting_key, setting_value, description)
values ('page_confirm_since_terms_version', '"2026-11-25b"'::jsonb,
        'A tutor who has accepted this Terms version or a later one: a booking from the tutor''s own page is confirmed without accepting (24 hours ahead).')
on conflict (setting_key) do nothing;

create or replace function public.tutor_books_on_confirm(p_tutor uuid)
returns boolean language sql stable security definer set search_path = public as $f$
  select exists (select 1 from public.system_settings s
                   join public.policy_acceptances a on a.document = 'terms' and a.version >= (s.setting_value #>> '{}')
                  where s.setting_key = 'page_confirm_since_terms_version' and coalesce(s.setting_value #>> '{}', '') <> '' and a.profile_id = p_tutor);
$f$;
revoke all on function public.tutor_books_on_confirm(uuid) from public, anon, authenticated;

-- The tutor's own screens ask whether the sentence about families booking without asking is true for them.
create or replace function public.my_page_books_on_confirm()
returns boolean language sql stable security definer set search_path = public as $f$
  select auth.uid() is not null and public.tutor_books_on_confirm(auth.uid())
     and exists (select 1 from public.tutor_public_profile x where x.tutor_id = auth.uid() and x.is_public)
     and exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid() and tp.is_verified);
$f$;
revoke all on function public.my_page_books_on_confirm() from public, anon;
grant execute on function public.my_page_books_on_confirm() to authenticated;

create or replace function public.finish_page_booking(p_request uuid, p_expected_rand integer)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  v_uid uuid := auth.uid();
  v_tutor uuid;
  v_level text;
  v_name text;
  r record;
  v_fit text;
  v_sent jsonb;
  v_claim jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Only ever the request confirm_page_booking has just made in this same transaction.
  if coalesce(current_setting('tutorlage.page_confirm', true), '') <> p_request::text then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select requested_tutor_id into v_tutor from public.session_requests where id = p_request and requested_by_profile_id = v_uid;
  if v_tutor is null then
    raise exception 'You can''t make this booking.' using errcode = '42501';
  end if;
  -- One booking at a time for one tutor: the second of two families waits here and then sees the first one's lesson.
  select current_sub_tier_id into v_level from public.tutor_profiles where id = v_tutor for update;
  select * into r from public.session_requests where id = p_request for update;
  if r.status <> 'pending' or r.payment_status <> 'initiated' or not coalesce(r.via_tutor_page, false) then
    raise exception 'You can''t make this booking.' using errcode = '42501';
  end if;
  select coalesce(public.display_name_part(split_part(btrim(coalesce(full_name, '')), ' ', 1)), 'This tutor') into v_name from public.profiles where id = v_tutor;
  if not public.tutor_books_on_confirm(v_tutor) or not public.tutor_page_open_to(v_tutor, v_uid) then
    raise exception '% cannot be booked from this page right now. Reload the page and try again.', v_name;
  end if;
  if not public.can_book_for(r.student_id) then
    raise exception 'You can''t make this booking.' using errcode = '42501';
  end if;
  if exists (select 1 from public.learner_tutor_choices where learner_id = r.student_id and tutor_id = v_tutor and choice = 'avoid') then
    raise exception 'You chose to try someone else instead of this tutor. Undo that under My tutors to ask for them again.';
  end if;
  if r.requested_start < now() + interval '24 hours' then
    raise exception 'Choose a time at least 24 hours from now.';
  end if;
  if r.min_sub_tier_id is distinct from v_level or r.institution_id is not null or r.curriculum_id is not null or r.enrollment_id is null then
    raise exception '%''s price or subjects have changed. Reload this page and try again.', v_name;
  end if;
  v_fit := public.request_fit_code(v_tutor, p_request);
  if v_fit is not null then
    if v_fit in ('busy', 'outside_hours', 'no_hours') then
      raise exception '% isn''t available at that time. Choose another time.', v_name;
    end if;
    raise exception '% cannot take that subject and grade. Choose another subject or grade.', v_name;
  end if;
  v_sent := public.send_request_wallet(p_request);
  if (v_sent ->> 'held_rand')::integer is distinct from p_expected_rand then
    raise exception 'The price has changed. Reload this page and check it before you confirm.';
  end if;
  v_claim := public.claim_session_request(p_request, v_tutor);
  if coalesce(v_claim ->> 'mode', '') <> 'already_paid' or v_claim ->> 'session_id' is null then
    raise exception 'The booking could not be made. Please try again.';
  end if;
  return public.page_booking_result(p_request);
end
$f$;

create or replace function public.page_booking_result(p_request uuid)
returns jsonb language sql stable security definer set search_path = public as $f$
  select jsonb_build_object('booked', true, 'request_id', r.id, 'session_id', r.resulting_session_id, 'start', r.requested_start, 'hours', r.duration_hours,
           'paid_rand', r.wallet_hold_rand, 'discount_rand', coalesce(r.promo_discount_rand, 0),
           'available_rand', (select w.available_rand from public.wallets w where w.profile_id = r.requested_by_profile_id))
    from public.session_requests r
   where r.id = p_request and r.requested_by_profile_id = auth.uid() and r.status = 'accepted' and r.resulting_session_id is not null;
$f$;

create or replace function public.confirm_page_booking(p_student uuid, p_enrollment uuid, p_tutor uuid, p_level text, p_start timestamptz, p_hours numeric,
                                                       p_reference text, p_expected_rand integer)
returns jsonb language plpgsql security invoker set search_path = public as $f$
declare
  v_old uuid;
  v_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_reference is null or p_reference !~ '^[A-Za-z0-9_-]{8,200}$' then
    raise exception 'A valid booking reference is required';
  end if;
  -- A second tap (or a retry after a lost answer) with the same reference gets the booking that was already made, and nothing new.
  perform pg_advisory_xact_lock(hashtextextended('page_booking:' || p_reference, 0));
  select id into v_old from public.session_requests where paystack_reference = p_reference and requested_by_profile_id = auth.uid();
  if v_old is not null then
    v_result := public.page_booking_result(v_old);
    if v_result is null then
      raise exception 'That booking attempt cannot be used again. Reload this page and try again.';
    end if;
    return v_result || jsonb_build_object('already', true);
  end if;
  perform set_config('tutorlage.page_confirm', 'new', true);
  insert into public.session_requests (student_id, enrollment_id, min_sub_tier_id, requested_by_profile_id, requested_start, duration_hours,
                                       paystack_reference, requested_tutor_id, via_tutor_page)
  values (p_student, p_enrollment, p_level, auth.uid(), p_start, p_hours, p_reference, p_tutor, true)
  returning id into v_id;
  perform set_config('tutorlage.page_confirm', v_id::text, true);
  v_result := public.finish_page_booking(v_id, p_expected_rand);
  perform set_config('tutorlage.page_confirm', '', true);
  return v_result;
end
$f$;

revoke all on function public.finish_page_booking(uuid, integer) from public, anon;
revoke all on function public.page_booking_result(uuid) from public, anon;
revoke all on function public.confirm_page_booking(uuid, uuid, uuid, text, timestamptz, numeric, text, integer) from public, anon;
grant execute on function public.finish_page_booking(uuid, integer) to authenticated;
grant execute on function public.page_booking_result(uuid) to authenticated;
grant execute on function public.confirm_page_booking(uuid, uuid, uuid, text, timestamptz, numeric, text, integer) to authenticated;

do $patch$
declare
  e record;
  v_def text;
  v_hits integer;
begin
  for e in
    select * from (values
      -- the page says how it is working
      ('public.public_tutor_page(text)',
       $o$'hours', v_hours, 'taking_requests', v_hours is not null,$o$,
       $n$'hours', v_hours, 'taking_requests', v_hours is not null, 'books_on_confirm', public.tutor_books_on_confirm(v_tutor),$n$),
      -- open times start 24 hours ahead for such a tutor, and there is no "as soon as possible"
      ('public.tutor_page_times(text,numeric,integer)',
       $o$when (slot.at_local at time zone 'Africa/Johannesburg') <= now() then false$o$,
       $n$when (slot.at_local at time zone 'Africa/Johannesburg') < now() + case when public.tutor_books_on_confirm(v_tutor) then interval '24 hours' else interval '1 microsecond' end then false$n$),
      ('public.tutor_page_times(text,numeric,integer)',
       $o$'now_ok', public.tutor_free_problem(v_tutor, now(), p_hours, null) is null,$o$,
       $n$'now_ok', not public.tutor_books_on_confirm(v_tutor) and public.tutor_free_problem(v_tutor, now(), p_hours, null) is null,$n$),
      -- no "please accept" notice for a booking that is confirmed in the same step
      ('public.notify_tutor_of_addressed_request()',
       $o$begin
  insert into public.notifications (profile_id, type, title, body)$o$,
       $n$begin
  if current_setting('tutorlage.page_confirm', true) = new.id::text then return null; end if; -- PAGE CONFIRM
  insert into public.notifications (profile_id, type, title, body)$n$),
      -- the tutor's bell: booked, who as today, subject, date and time
      ('public.notify_tutor_session_booked()',
       $o$    'You have an upcoming session',
    format('Session with %s%s, %s. Open Sessions to start the video call when it is time.',$o$,
       $n$    case when coalesce(current_setting('tutorlage.page_confirm', true), '') <> '' then 'A lesson was booked from your page' else 'You have an upcoming session' end,
    format(case when coalesce(current_setting('tutorlage.page_confirm', true), '') <> ''
                then 'Booked: %s%s, %s. You do not need to accept it. If you cannot teach it, cancel it under Sessions.'
                else 'Session with %s%s, %s. Open Sessions to start the video call when it is time.' end,$n$),
      -- the family's bell
      ('public.create_wallet_session(uuid,uuid,integer)',
       $o$select distinct p, 'request_accepted', 'A tutor accepted your request',
         'Your session is booked. R' || v_price || ' was taken from your credit. Open Sessions to see your tutor and, closer to the time, the meeting link.',$o$,
       $n$select distinct p, 'request_accepted', case when current_setting('tutorlage.page_confirm', true) = p_request_id::text then 'Your lesson is booked' else 'A tutor accepted your request' end,
         case when current_setting('tutorlage.page_confirm', true) = p_request_id::text
           then 'Your lesson with ' || coalesce((select public.display_name_part(split_part(btrim(coalesce(full_name, '')), ' ', 1)) from public.profiles where id = p_tutor_id), 'your tutor')
                || coalesce(' (' || (select subject_name from public.student_subject_enrollments where id = v_req.enrollment_id) || ')', '')
                || ', ' || to_char(v_req.requested_start at time zone 'Africa/Johannesburg', 'FMDy FMDD FMMon HH24:MI') || ' SAST, is booked. R' || v_price
                || ' was taken from your credit. Open Sessions to see it and, closer to the time, the meeting link.'
           else 'Your session is booked. R' || v_price || ' was taken from your credit. Open Sessions to see your tutor and, closer to the time, the meeting link.' end,$n$)
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(e.fn::regprocedure);
    v_hits := (length(v_def) - length(replace(v_def, e.old_text, ''))) / length(e.old_text);
    if v_hits <> 1 then
      raise exception 'page_booking_confirm: % expected the old text once, found %', e.fn, v_hits;
    end if;
    execute replace(v_def, e.old_text, e.new_text);
  end loop;
end
$patch$;
