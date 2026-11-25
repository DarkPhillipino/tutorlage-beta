-- JOB FIT (PM line 78, 25 Nov 2026): the booking-time gap.
-- Before: the hours, busy, subject, grade and curriculum check on a request addressed to one tutor ran only for a family with a completed session with that
-- tutor, so a family that signed up from the tutor's link could send (and pay a credit hold for) a request the tutor could never see or accept.
--   CHANGED addressed_fit_problem: the linked family (same code-owner condition as 20261124220000) gets the same check; the refusal no longer uses the old word.
--   NEW     addressed_send_problem(request): internal; asks request_fit_code, the rule that decides whether the tutor sees the request, again at the moment of sending.
--   CHANGED send_request_wallet, send_request_free, record_card_verification: call it before anything is held, sent or marked.
--   CHANGED my_linked_tutor: also answers the tutor's working hours in words (already shown on the public page).
-- The four patched functions are edited in place from the text the database holds; each edit must find its anchor exactly once or the migration stops.
-- Running it twice changes nothing. UNDO: Drake/programmer/rollbacks/20261125120000_addressed_fit_linked_family_ROLLBACK.sql

create or replace function public.addressed_fit_problem(p_student uuid, p_requested_by uuid, p_tutor uuid, p_enrollment uuid, p_institution uuid, p_curriculum uuid, p_start timestamp with time zone, p_hours numeric)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_subject text;
  v_grade text;
  v_code text;
begin
  -- Same caller checks as addressed_request_problem, and only for a tutor this learner has had or whose own code the payer carries: nobody can use this to look at other tutors.
  if auth.uid() is null or auth.uid() is distinct from p_requested_by or p_student is null or not public.can_book_for(p_student)
     or (not exists (select 1 from public.sessions where student_id = p_student and tutor_id = p_tutor and status = 'completed')
         and not exists (
           select 1
             from public.profiles pr
             join public.promo_codes pc on pc.id = pr.promo_code_id and pc.active and pc.owner_tutor_id = p_tutor
             join public.tutor_public_profile x on x.tutor_id = p_tutor and x.is_public
            where pr.id = p_requested_by)) then
    return null;
  end if;
  if p_enrollment is not null then
    select subject_name, grade_level into v_subject, v_grade from public.student_subject_enrollments where id = p_enrollment;
  end if;
  v_code := public.tutor_qualify_problem(p_tutor, v_subject, v_grade, p_institution, p_curriculum);
  if v_code is not null then
    return 'This tutor isn''t approved for that subject, grade and curriculum. You can send the request to any available tutor.';
  end if;
  v_code := public.tutor_free_problem(p_tutor, greatest(p_start, now()), p_hours, null);
  if v_code is not null then
    return 'This tutor isn''t available at that time. Choose another time, or send the request to any available tutor.';
  end if;
  return null;
end;
$function$;

create or replace function public.addressed_send_problem(p_request uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tutor uuid;
  v_code text;
begin
  select requested_tutor_id into v_tutor from public.session_requests where id = p_request;
  if v_tutor is null then
    return null;
  end if;
  v_code := public.request_fit_code(v_tutor, p_request);
  if v_code is null then
    return null;
  end if;
  return case
    when v_code in ('busy', 'outside_hours', 'no_hours') then 'This tutor isn''t available at that time. Choose another time, or send the request to any available tutor.'
    when v_code in ('no_subject', 'not_approved', 'wrong_grade', 'wrong_curriculum') then 'This tutor isn''t approved for that subject, grade and curriculum. You can send the request to any available tutor.'
    when v_code = 'wrong_school' then 'This tutor works with a different institution. You can send the request to any available tutor.'
    else 'That tutor can''t take this request right now. You can send it to any available tutor.'
  end;
end;
$function$;

-- Only the sending functions (which run as the owner) call it.
revoke all on function public.addressed_send_problem(uuid) from public, anon, authenticated;

do $patch$
declare
  e record;
  v_def text;
  v_hits integer;
begin
  for e in
    select * from (values
      ('public.send_request_wallet(uuid)',
       '  -- PROMO CODES send 2 (CEO, 5 Nov 2026):',
       $new$  -- JOB FIT send (25 Nov 2026): a request addressed to one tutor is looked at again before any credit is held.
  if public.addressed_send_problem(v_req.id) is not null then
    raise exception using message = public.addressed_send_problem(v_req.id), detail = 'addressed_tutor';
  end if;
  -- PROMO CODES send 2 (CEO, 5 Nov 2026):$new$),
      ('public.send_request_free(uuid)',
       '  -- The same move a verified card check makes, without a card.',
       $new$  -- JOB FIT send (25 Nov 2026): a request addressed to one tutor is looked at again before it is sent.
  if public.addressed_send_problem(v_req.id) is not null then
    raise exception using message = public.addressed_send_problem(v_req.id), detail = 'addressed_tutor';
  end if;
  -- The same move a verified card check makes, without a card.$new$),
      ('public.record_card_verification(text,bigint,text,jsonb,text)',
       '  select id into v_card from public.payment_cards',
       $new$  -- JOB FIT card (25 Nov 2026): a request addressed to one tutor who can no longer take it is not sent; the page shows the reason.
  if public.addressed_send_problem(v_req.id) is not null then
    update public.session_requests
    set status = 'cancelled', responded_at = now(), payment_status = 'failed', charge_failure_reason = public.addressed_send_problem(v_req.id)
    where id = v_req.id;
    return 'failed';
  end if;

  select id into v_card from public.payment_cards$new$),
      ('public.my_linked_tutor()',
       'return jsonb_build_object(''tutor_id'', v_tutor, ''first_name'', v_first);',
       $new$return jsonb_build_object('tutor_id', v_tutor, 'first_name', v_first, 'hours', public.tutor_hours_in_words(v_tutor)); -- JOB FIT hours (25 Nov 2026)$new$)
    ) as t(fn, anchor, replacement)
  loop
    v_def := pg_get_functiondef(e.fn::regprocedure);
    if position('JOB FIT' in v_def) > 0 then
      continue;  -- already patched
    end if;
    v_hits := (length(v_def) - length(replace(v_def, e.anchor, ''))) / length(e.anchor);
    if v_hits <> 1 then
      raise exception 'JOB FIT: anchor found % times in %', v_hits, e.fn;
    end if;
    execute replace(v_def, e.anchor, e.replacement);
  end loop;
end $patch$;
