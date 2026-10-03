-- 2026-09-30. Three P0 items that meet on the same tables:
--   7m  — a matched session had no way to happen: add a meeting link the tutor sets.
--   10  — tier progression never fired because nothing could complete a session: add completion.
--   7f  — credential-based entry: schema and the monotonic floor in fn_recalculate_tutor_tier.
--         (Not exposed to tutors yet — the CEO's safeguarding precondition applies.)

-- 7m: meeting link ------------------------------------------------------------------------------
alter table public.sessions add column if not exists meeting_url text;
alter table public.sessions drop constraint if exists sessions_meeting_url_https;
alter table public.sessions add constraint sessions_meeting_url_https
  check (meeting_url is null or meeting_url ~ '^https://[^[:space:]]{4,500}$');

create or replace function public.set_session_meeting_link(p_session_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select tutor_id, student_id, status into v_session from public.sessions where id = p_session_id for update;
  if not found or v_session.tutor_id is distinct from auth.uid() then
    raise exception 'Only this session''s tutor can set its link' using errcode = '42501';
  end if;
  if v_session.status not in ('scheduled', 'pending_confirmation') then
    raise exception 'This session isn''t upcoming any more';
  end if;
  if p_url is null or p_url !~ '^https://[^[:space:]]{4,500}$' then
    raise exception 'Enter the full meeting link, starting with https://';
  end if;
  update public.sessions set meeting_url = p_url where id = p_session_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (v_session.student_id, 'session_link', 'Your session link is ready',
          'Your tutor added the link to join your session.', p_session_id);
end;
$$;
revoke all on function public.set_session_meeting_link(uuid, text) from public, anon;
grant execute on function public.set_session_meeting_link(uuid, text) to authenticated;

-- 10: completing a session ------------------------------------------------------------------------
create or replace function public.complete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select tutor_id, student_id, status, scheduled_start, duration_hours into v_session
  from public.sessions where id = p_session_id for update;
  if not found or v_session.tutor_id is distinct from auth.uid() then
    raise exception 'Only this session''s tutor can mark it complete' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'Only a scheduled session can be marked complete';
  end if;
  if now() < v_session.scheduled_start + make_interval(mins => (v_session.duration_hours * 60)::int) then
    raise exception 'You can mark a session complete once its scheduled time has ended';
  end if;
  -- trigger_session_completed then runs fn_recalculate_tutor_tier for this tutor.
  update public.sessions set status = 'completed', completed_at = now() where id = p_session_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (v_session.student_id, 'session_completed', 'How was your session?',
          'Your tutor marked the session complete. Rate it to help other learners.', p_session_id);
end;
$$;
revoke all on function public.complete_session(uuid) from public, anon;
grant execute on function public.complete_session(uuid) to authenticated;

-- 7f: credential route schema ---------------------------------------------------------------------
alter table public.tutor_profiles
  add column if not exists credential_floor_sub_tier_id varchar references public.sub_tier_definitions(id);

create table if not exists public.credential_definitions (
  code text primary key,
  label text not null,
  entry_sub_tier_id varchar not null references public.sub_tier_definitions(id),
  recency_years integer,          -- null = doesn't expire
  description text
);
alter table public.credential_definitions enable row level security;
drop policy if exists "Anyone can read credential definitions" on public.credential_definitions;
create policy "Anyone can read credential definitions" on public.credential_definitions for select using (true);
drop policy if exists "Admins manage credential definitions" on public.credential_definitions;
create policy "Admins manage credential definitions" on public.credential_definitions
  for all using (public.is_active_admin()) with check (public.is_active_admin());
grant select on public.credential_definitions to anon, authenticated;
grant insert, update, delete on public.credential_definitions to authenticated;

-- The mapping settled on 2026-09-26 (Drake/programmer/pm-instructions.md). Credentials set the
-- starting tier; sub-tier is still earned; a floor does not survive a freeze.
insert into public.credential_definitions (code, label, entry_sub_tier_id, recency_years, description) values
  ('practicum_complete', 'Student teacher with a completed supervised practicum', '2C', null,
   'Completed supervised classroom practice as part of a B.Ed or PGCE.'),
  ('sace_registered_teacher', 'SACE-registered qualified teacher', '2C', null,
   'Registered with the South African Council for Educators.'),
  ('sace_fet_subject_teacher', 'SACE-registered teacher of this subject at FET/matric phase', '3A', null,
   'Teaches the subject to Grade 10-12 classes.'),
  ('subject_leader', 'Head of department or subject head (or equivalent)', '3C', null,
   'Leads the subject at their school. Role language, not post level, so independent schools count.'),
  ('exam_marker', 'NSC, IEB or Cambridge exam marker (last 5 years)', '4A', 5,
   'Appointed to mark exit-level papers within the recency window (3-5 years; 5 used).'),
  ('exam_moderator_examiner', 'Exam moderator, chief marker or examiner', '4B', null,
   'Quality-assures or sets exit-level papers for a real board.')
on conflict (code) do nothing;

create table if not exists public.tutor_credentials (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  credential_code text not null references public.credential_definitions(code),
  document_id uuid references public.tutor_verification_documents(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  obtained_on date,
  verified_by uuid references public.admin_profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tutor_credentials_tutor_id_idx on public.tutor_credentials (tutor_id);
alter table public.tutor_credentials enable row level security;
drop policy if exists "Tutors view own credentials" on public.tutor_credentials;
create policy "Tutors view own credentials" on public.tutor_credentials for select using (auth.uid() = tutor_id);
drop policy if exists "Admins manage tutor credentials" on public.tutor_credentials;
create policy "Admins manage tutor credentials" on public.tutor_credentials
  for all using (public.is_active_admin()) with check (public.is_active_admin());
grant select, insert, update, delete on public.tutor_credentials to authenticated;

-- The floor is always derived from verified, in-date credentials — never set by hand.
create or replace function public.refresh_credential_floor(p_tutor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor varchar;
begin
  select d.entry_sub_tier_id into v_floor
  from public.tutor_credentials c
  join public.credential_definitions d on d.code = c.credential_code
  join public.sub_tier_definitions s on s.id = d.entry_sub_tier_id
  where c.tutor_id = p_tutor_id
    and c.status = 'verified'
    and (d.recency_years is null or c.obtained_on is null
         or c.obtained_on >= (current_date - make_interval(years => d.recency_years))::date)
  order by s.max_allowed_rate desc
  limit 1;

  update public.tutor_profiles set credential_floor_sub_tier_id = v_floor where id = p_tutor_id;
  perform public.fn_recalculate_tutor_tier(p_tutor_id);
end;
$$;
revoke all on function public.refresh_credential_floor(uuid) from public, anon, authenticated;

create or replace function public.trg_on_tutor_credential_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_credential_floor(coalesce(new.tutor_id, old.tutor_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trigger_tutor_credential_change on public.tutor_credentials;
create trigger trigger_tutor_credential_change
  after insert or update or delete on public.tutor_credentials
  for each row execute function public.trg_on_tutor_credential_change();
revoke all on function public.trg_on_tutor_credential_change() from public, anon, authenticated;

-- The tutor-profile guard also protects the new floor column.
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
    new.credential_floor_sub_tier_id := null;
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
      new.credential_floor_sub_tier_id, new.total_completed_hours, new.avg_rating, new.total_reviews_count,
      new.repeat_student_rate_pct, new.avg_grade_uplift_pct, new.qualified_uplift_students_count,
      new.total_sessions_completed, new.tier_frozen, new.freeze_reason, new.fast_track_status, new.created_at)
     is distinct from
     (old.id, old.is_verified, old.onboarding_status, old.current_tier_id, old.current_sub_tier_id,
      old.credential_floor_sub_tier_id, old.total_completed_hours, old.avg_rating, old.total_reviews_count,
      old.repeat_student_rate_pct, old.avg_grade_uplift_pct, old.qualified_uplift_students_count,
      old.total_sessions_completed, old.tier_frozen, old.freeze_reason, old.fast_track_status, old.created_at) then
    raise exception 'Only Tutorlage can change verification, tier, rating or freeze details'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- fn_recalculate_tutor_tier, rewritten. Changes from the original (every one found in the
-- 2026-09-26/30 examinations):
--   * monotonic floor: the target is the higher of earned eligibility and the credential floor —
--     previously any recalculation reset a credentialed tutor to 1A;
--   * a downward move is logged as DEMOTION, not PROMOTION;
--   * stats (including total_sessions_completed, which was never counted) are stored every time;
--   * only a *rating* freeze is lifted automatically — an admin suspension (also tier_frozen) used
--     to be silently undone by the next review;
--   * the freeze path itself is unchanged: frozen means no movement, floor or not (educator's ruling).
create or replace function public.fn_recalculate_tutor_tier(p_tutor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_rating_freeze constant text := 'Average rating dropped below 4.70 threshold.';
  v_completed_hours numeric(10, 2);
  v_sessions integer;
  v_avg_rating numeric(3, 2);
  v_reviews_count integer;
  v_repeat_rate numeric(5, 2);
  v_avg_uplift numeric(5, 2);
  v_uplift_count integer;
  v_profile record;
  v_earned record;
  v_floor record;
  v_target record;
  v_current record;
begin
  select coalesce(sum(duration_hours), 0), count(*) into v_completed_hours, v_sessions
  from public.sessions where tutor_id = p_tutor_id and status = 'completed';

  select coalesce(avg(rating), 0), count(*) into v_avg_rating, v_reviews_count
  from public.reviews where tutor_id = p_tutor_id;

  with student_counts as (
    select student_id, count(*) as session_count
    from public.sessions where tutor_id = p_tutor_id and status = 'completed'
    group by student_id
  )
  select case when count(*) = 0 then 0
              else (count(*) filter (where session_count > 1))::numeric / count(*)::numeric * 100 end
  into v_repeat_rate from student_counts;

  select coalesce(avg(uplift_delta_pct), 0), count(distinct student_id) into v_avg_uplift, v_uplift_count
  from public.student_academic_records where tutor_id = p_tutor_id and current_score_pct is not null;

  select current_sub_tier_id, credential_floor_sub_tier_id, tier_frozen, freeze_reason into v_profile
  from public.tutor_profiles where id = p_tutor_id;
  if not found then
    return;
  end if;

  update public.tutor_profiles set
    total_completed_hours = v_completed_hours,
    total_sessions_completed = v_sessions,
    avg_rating = v_avg_rating,
    total_reviews_count = v_reviews_count,
    repeat_student_rate_pct = v_repeat_rate,
    avg_grade_uplift_pct = v_avg_uplift,
    qualified_uplift_students_count = v_uplift_count,
    updated_at = now()
  where id = p_tutor_id;

  if v_avg_rating < 4.70 and v_reviews_count >= 3 then
    if not coalesce(v_profile.tier_frozen, false) then
      update public.tutor_profiles set tier_frozen = true, freeze_reason = c_rating_freeze where id = p_tutor_id;
      insert into public.tutor_progression_logs (tutor_id, old_sub_tier, new_sub_tier, action_type, message)
      values (p_tutor_id, v_profile.current_sub_tier_id, v_profile.current_sub_tier_id, 'FREEZE',
              'Rates frozen due to low rating.');
    end if;
    return;
  end if;

  if coalesce(v_profile.tier_frozen, false) then
    if v_profile.freeze_reason = c_rating_freeze then
      update public.tutor_profiles set tier_frozen = false, freeze_reason = null where id = p_tutor_id;
    else
      return;  -- frozen for another reason (e.g. an admin suspension): don't move or unfreeze
    end if;
  end if;

  select id, tier_id, max_allowed_rate into v_earned
  from public.sub_tier_definitions
  where min_hours <= v_completed_hours
    and min_rating <= v_avg_rating
    and min_repeat_rate_pct <= v_repeat_rate
    and min_written_reviews <= v_reviews_count
    and min_distinct_students_uplift <= v_uplift_count
    and required_grade_uplift_pct <= v_avg_uplift
  order by max_allowed_rate desc
  limit 1;
  if v_earned.id is null then
    select id, tier_id, max_allowed_rate into v_earned from public.sub_tier_definitions where id = '1A';
  end if;

  v_target := v_earned;
  if v_profile.credential_floor_sub_tier_id is not null then
    select id, tier_id, max_allowed_rate into v_floor
    from public.sub_tier_definitions where id = v_profile.credential_floor_sub_tier_id;
    if v_floor.max_allowed_rate > v_target.max_allowed_rate then
      v_target := v_floor;
    end if;
  end if;

  if v_target.id is distinct from v_profile.current_sub_tier_id then
    select id, max_allowed_rate into v_current
    from public.sub_tier_definitions where id = v_profile.current_sub_tier_id;

    update public.tutor_profiles
    set current_tier_id = v_target.tier_id, current_sub_tier_id = v_target.id, updated_at = now()
    where id = p_tutor_id;

    insert into public.tutor_progression_logs (tutor_id, old_sub_tier, new_sub_tier, action_type, message)
    values (
      p_tutor_id, v_profile.current_sub_tier_id, v_target.id,
      case when v_target.max_allowed_rate > coalesce(v_current.max_allowed_rate, 0) then 'PROMOTION' else 'DEMOTION' end,
      case when v_target.max_allowed_rate > coalesce(v_current.max_allowed_rate, 0)
           then concat('Unlocked level ', v_target.id, '! Your price level is now R', v_target.max_allowed_rate, '.')
           else concat('Your level changed to ', v_target.id, '.') end
    );
  end if;
end;
$$;
revoke all on function public.fn_recalculate_tutor_tier(uuid) from public, anon, authenticated;

-- An admin completing a session directly (not via complete_session) runs this trigger as
-- `authenticated`, which can't execute fn_recalculate_tutor_tier — run the trigger as its owner.
alter function public.trg_on_session_completed() security definer;
