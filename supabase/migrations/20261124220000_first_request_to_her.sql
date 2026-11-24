-- JOB JOURNEY (PM line 60, 24 Nov 2026): a family that signs up with a tutor's own code has its FIRST request addressed to HER.
-- Before: an addressed request was allowed only for a tutor the learner had already had a completed session with ("book again"), so a family from her link
-- went to general matching. Now: the payer's attached code (profiles.promo_code_id) owned by that tutor (promo_codes.owner_tutor_id), with her public page on,
-- also allows an addressed request. Everything else in the check is unchanged (verified, level, subject, institution, avoid, ended pairing, 3 waiting).
--   CHANGED  public.addressed_request_problem(uuid,uuid,uuid,text,uuid,uuid): one condition ("had a session") gains an "or this is the code owner" branch.
--   NEW      public.my_linked_tutor(): signed in; answers {tutor_id, first_name} of the tutor whose own code is attached to the caller, only while her page is on and
--            only until the caller has had a first lesson booked; otherwise null. Nothing else about her.
-- UNDO: restore the old text of addressed_request_problem from Drake/programmer/backups/2026-11-24-addressed_request_problem.sql and drop my_linked_tutor().

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
set search_path to 'public'
as $function$
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
  if not exists (select 1 from public.sessions where student_id = p_student and tutor_id = p_tutor and status = 'completed')
     and not exists (
       select 1
         from public.profiles pr
         join public.promo_codes pc on pc.id = pr.promo_code_id and pc.active and pc.owner_tutor_id = p_tutor
         join public.tutor_public_profile x on x.tutor_id = p_tutor and x.is_public
        where pr.id = p_requested_by) then
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
$function$;

create or replace function public.my_linked_tutor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_first text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select pc.owner_tutor_id into v_tutor
    from public.profiles pr
    join public.promo_codes pc on pc.id = pr.promo_code_id and pc.active and pc.owner_tutor_id is not null
   where pr.id = auth.uid();
  if v_tutor is null or v_tutor = auth.uid() then return null; end if;
  if not exists (select 1 from public.tutor_public_profile x where x.tutor_id = v_tutor and x.is_public)
     or not exists (select 1 from public.tutor_profiles tp where tp.id = v_tutor and tp.is_verified) then
    return null;
  end if;
  -- her family's FIRST request only: once any request of this account has become a lesson, the ordinary "book again" path takes over
  if exists (select 1 from public.session_requests q where q.requested_by_profile_id = auth.uid() and q.resulting_session_id is not null) then
    return null;
  end if;
  select coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'your tutor') into v_first from public.profiles p where p.id = v_tutor;
  return jsonb_build_object('tutor_id', v_tutor, 'first_name', v_first);
end;
$$;
revoke all on function public.my_linked_tutor() from public, anon;
grant execute on function public.my_linked_tutor() to authenticated;
