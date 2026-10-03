-- Backlog item 7i (2026-09-30): close the trust-boundary holes found in the 2026-09-29 scan.
-- Applied to dev (wfpjoxetbprmllqqarwp) first, then production (qxzhqylrrspumvguflwj) for parity.
--
-- Pattern used throughout: a guard trigger lets ordinary API callers (the `authenticated` / `anon`
-- roles, i.e. anyone using the publishable key) change only the fields that are genuinely theirs.
-- Anything running as a privileged role — SECURITY DEFINER functions, pg_cron jobs, the server's
-- service-role key — and active admins pass through unchanged.

-- 1. tutor_profiles: tutors can't set their own verification, tier, stats or freeze state -------
create or replace function public.guard_tutor_profiles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_verified := false;
    new.onboarding_status := 'pending_academic';
    new.current_tier_id := 1;
    new.current_sub_tier_id := '1A';
    new.total_completed_hours := 0;
    new.avg_rating := 0;
    new.total_reviews_count := 0;
    new.repeat_student_rate_pct := 0;
    new.avg_grade_uplift_pct := 0;
    new.qualified_uplift_students_count := 0;
    new.total_sessions_completed := 0;
    new.tier_frozen := false;
    new.freeze_reason := null;
    new.fast_track_status := 'none';
    return new;
  end if;

  if (new.id, new.is_verified, new.onboarding_status, new.current_tier_id, new.current_sub_tier_id,
      new.total_completed_hours, new.avg_rating, new.total_reviews_count, new.repeat_student_rate_pct,
      new.avg_grade_uplift_pct, new.qualified_uplift_students_count, new.total_sessions_completed,
      new.tier_frozen, new.freeze_reason, new.fast_track_status, new.created_at)
     is distinct from
     (old.id, old.is_verified, old.onboarding_status, old.current_tier_id, old.current_sub_tier_id,
      old.total_completed_hours, old.avg_rating, old.total_reviews_count, old.repeat_student_rate_pct,
      old.avg_grade_uplift_pct, old.qualified_uplift_students_count, old.total_sessions_completed,
      old.tier_frozen, old.freeze_reason, old.fast_track_status, old.created_at) then
    raise exception 'Only Tutorlage can change verification, tier, rating or freeze details'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_tutor_profiles on public.tutor_profiles;
create trigger guard_tutor_profiles
  before insert or update on public.tutor_profiles
  for each row execute function public.guard_tutor_profiles();

-- Unverified tutors were publicly readable through a `qual: true` policy. The remaining public
-- policy shows verified tutors (or yourself); admins and a tutor's own students get explicit ones.
drop policy if exists "Anyone can view verified tutors" on public.tutor_profiles;
create policy "Admins view all tutor profiles" on public.tutor_profiles
  for select using (public.is_active_admin());
create policy "Students view tutors of their own sessions" on public.tutor_profiles
  for select using (exists (
    select 1 from public.sessions s where s.tutor_id = tutor_profiles.id and s.student_id = auth.uid()
  ));
-- The admin app's approve/reject/suspend actions update tutor_profiles, but no admin UPDATE
-- policy existed, so they silently matched zero rows for any tutor other than the admin.
create policy "Admins update tutor profiles" on public.tutor_profiles
  for update using (public.is_active_admin()) with check (public.is_active_admin());

-- 2. profiles: no self-service role changes except the OAuth student -> tutor fix-up ----------
create or replace function public.guard_profiles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role not in ('student', 'tutor', 'parent') then
    raise exception 'That account type can''t be self-assigned' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'Profile id can''t change' using errcode = '42501';
    end if;
    if new.role is distinct from old.role and not (old.role = 'student' and new.role = 'tutor') then
      raise exception 'That account type change isn''t allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profiles on public.profiles;
create trigger guard_profiles
  before insert or update on public.profiles
  for each row execute function public.guard_profiles();

-- 3. tutor_verification_documents: tutors upload, only admins decide --------------------------
create or replace function public.guard_verification_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.admin_notes := null;
    new.reviewed_at := null;
    return new;
  end if;
  if new.tutor_id is distinct from old.tutor_id then
    raise exception 'A document can''t be moved to another tutor' using errcode = '42501';
  end if;
  if new.document_url is distinct from old.document_url then
    -- A replaced document goes back into the review queue.
    new.status := 'pending';
    new.admin_notes := null;
    new.reviewed_at := null;
    return new;
  end if;
  if (new.status, new.admin_notes, new.reviewed_at) is distinct from (old.status, old.admin_notes, old.reviewed_at) then
    raise exception 'Only Tutorlage can review documents' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_verification_documents on public.tutor_verification_documents;
create trigger guard_verification_documents
  before insert or update on public.tutor_verification_documents
  for each row execute function public.guard_verification_documents();

-- 4. session_requests: the database sets price and status; payment is confirmed server-side ----
create or replace function public.guard_session_request_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_price numeric;
  v_currency text;
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

  if new.duration_hours is null or new.duration_hours <= 0 or new.duration_hours > 8 then
    raise exception 'A session has to be between a few minutes and 8 hours long';
  end if;
  if new.paystack_reference is null or new.paystack_reference !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception 'A valid payment reference is required';
  end if;
  if new.tier_id is null then
    raise exception 'Choose a pricing level before sending a request';
  end if;

  select min_rate, currency_code into v_price, v_currency from public.tier_definitions where id = new.tier_id;
  if v_price is null then
    raise exception 'Unknown pricing level';
  end if;
  -- The price is always the database's, never the browser's.
  new.charged_amount := round(v_price * new.duration_hours, 2);
  new.currency_code := trim(v_currency);
  return new;
end;
$$;

drop trigger if exists guard_session_request_insert on public.session_requests;
create trigger guard_session_request_insert
  before insert on public.session_requests
  for each row execute function public.guard_session_request_insert();

-- Clients may read and create; they can no longer update or delete. Claiming goes through
-- accept_session_request() below; payment status is written by server/ with the service key.
drop policy if exists "Students manage own session requests" on public.session_requests;
drop policy if exists "Tutors view and respond to their requests" on public.session_requests;
drop policy if exists "Tutors claim unclaimed pending requests" on public.session_requests;
create policy "Students view own session requests" on public.session_requests
  for select using (auth.uid() = student_id or auth.uid() = requested_by_profile_id);
create policy "Students create own session requests" on public.session_requests
  for insert with check (auth.uid() = student_id and auth.uid() = requested_by_profile_id);
create policy "Tutors view requests they accepted" on public.session_requests
  for select using (auth.uid() = tutor_id);
create policy "Admins manage session requests" on public.session_requests
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- 5. sessions: created only by the accept function, with amounts computed in the database ------
drop policy if exists "Students can create sessions" on public.sessions;
drop policy if exists "Students create own sessions" on public.sessions;
drop policy if exists "Tutors create sessions for their own accepted requests" on public.sessions;
create policy "Admins manage sessions" on public.sessions
  for all using (public.is_active_admin()) with check (public.is_active_admin());

create or replace function public.accept_session_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tutor record;
  v_req record;
  v_subject text;
  v_commission numeric;
  v_session_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select id, is_verified, current_tier_id, institution_id into v_tutor
  from public.tutor_profiles where id = v_uid;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests'
      using errcode = '42501';
  end if;

  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.tutor_id is not null or v_req.status <> 'pending' or v_req.payment_status <> 'paid' then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;
  if v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
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
      where c.tutor_id = v_uid and lower(c.subject_name) = lower(v_subject)
    ) then
      raise exception 'You don''t teach this subject yet.';
    end if;
  end if;

  select commission_rate_pct into v_commission from public.tier_definitions where id = v_tutor.current_tier_id;

  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status
  ) values (
    v_req.student_id, v_uid, v_req.duration_hours, round(v_req.charged_amount / v_req.duration_hours, 2),
    v_commission, v_req.charged_amount, round(v_req.charged_amount * (1 - v_commission / 100), 2),
    v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.currency_code,
    'scheduled'
  ) returning id into v_session_id;

  update public.session_requests
  set tutor_id = v_uid, status = 'accepted', responded_at = now(), resulting_session_id = v_session_id
  where id = p_request_id;

  return v_session_id;
end;
$$;

revoke all on function public.accept_session_request(uuid) from public, anon;
grant execute on function public.accept_session_request(uuid) to authenticated;

-- 6. reviews: only for your own completed session, one per session ----------------------------
drop policy if exists "Students can create reviews" on public.reviews;
drop policy if exists "Students write reviews for own sessions" on public.reviews;
create policy "Students review their own completed sessions" on public.reviews
  for insert with check (
    auth.uid() = student_id
    and rating between 1 and 5
    and exists (
      select 1 from public.sessions s
      where s.id = reviews.session_id and s.student_id = auth.uid()
        and s.tutor_id = reviews.tutor_id and s.status = 'completed'
    )
  );
create unique index if not exists reviews_one_per_session on public.reviews (session_id);
grant insert (session_id, tutor_id, student_id, rating, comment) on public.reviews to authenticated;

-- 7. Hygiene: pin search_path on the trigger/progression functions (same class of bug that broke
-- handle_new_user_role_expansion), and reconcile the Tier 2 fallback commission to the documented
-- 24% (dev had drifted to 25%).
alter function public.trg_on_review_submitted() set search_path = public;
alter function public.trg_on_session_completed() set search_path = public;
alter function public.fn_recalculate_tutor_tier(uuid) set search_path = public;
alter function public.fn_sync_academic_record_from_assessment() set search_path = public;
alter function public.fn_notify_on_progression_log() set search_path = public;
update public.tier_definitions set commission_rate_pct = 24.00 where id = 2 and commission_rate_pct <> 24.00;
