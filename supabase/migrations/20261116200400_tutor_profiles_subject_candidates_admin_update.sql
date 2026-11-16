-- TUTOR PROFILES AND SUBJECT CANDIDATES: WHO MAY UPDATE THEM, AND WHICH COLUMNS (P2 security round 2, group 5, 16 Nov 2026).
-- The hole: "Admins update tutor profiles" (public.tutor_profiles, UPDATE) and "Admins update subject candidates" (public.subject_candidates, UPDATE) test only
-- public.is_active_admin(). So any active admin, a support agent too, can approve or reject a tutor, and (because guard_tutor_profiles waves every admin
-- through) overwrite a tutor's completed hours, rating, review count and level through the API.
-- What the admin app really does (read from admin/src on 16 Nov): approve, reject and suspend a tutor on the Tutor Verification and Safety Holds pages
-- (verification_officer and super_admin only); each writes only onboarding_status, is_verified, is_dispatch_active, tier_frozen and freeze_reason. It never
-- writes subject_candidates directly (the only function that writes it, closure_delete_data, is SECURITY DEFINER); the table holds 0 rows.
--
-- WHAT THIS MIGRATION DOES
--  1. Re-creates public.admin_role_in(text[]) (identical to group 1's, so the groups can be applied in any order).
--  2. tutor_profiles: DROP "Admins update tutor profiles"; CREATE "Verification staff update tutor profiles" (UPDATE, using and with check
--     admin_role_in(verification_officer, super_admin)).
--  3. A new trigger tutor_profiles_admin_columns (BEFORE UPDATE, SECURITY INVOKER on purpose so current_user is the caller): a call through the API by an
--     admin may no longer change what is worked out by the platform: id, created_at, current_tier_id, current_sub_tier_id, credential_floor_sub_tier_id,
--     total_completed_hours, avg_rating, total_reviews_count, repeat_student_rate_pct, avg_grade_uplift_pct, qualified_uplift_students_count,
--     total_sessions_completed, fast_track_status. These are the columns guard_tutor_profiles already locks for tutors; admin_assign_tier and the tier
--     recalculation (SECURITY DEFINER, run as the owner) still change level and hours, and the five columns the admin app writes are untouched.
--     guard_tutor_profiles itself is NOT changed.
--  4. subject_candidates: DROP "Admins update subject candidates" and put nothing back: no screen and no invoker function updates this table. Admins keep
--     "Admins view all subject candidates" (SELECT); a tutor keeps their own insert and read. A role-limited UPDATE can be added the day a screen needs it.
-- Untouched: the tutors' own policies (two duplicate "update own" policies exist: noted in the report, left alone), every other trigger and function.

create or replace function public.admin_role_in(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.id = auth.uid() and a.is_active and a.admin_role::text = any (p_roles)
  );
$$;
revoke all on function public.admin_role_in(text[]) from public, anon;
grant execute on function public.admin_role_in(text[]) to authenticated;

-- ---- tutor_profiles ------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins update tutor profiles" on public.tutor_profiles;
drop policy if exists "Verification staff update tutor profiles" on public.tutor_profiles;
create policy "Verification staff update tutor profiles" on public.tutor_profiles
  for update to authenticated
  using (public.admin_role_in(array['verification_officer', 'super_admin']))
  with check (public.admin_role_in(array['verification_officer', 'super_admin']));

create or replace function public.tutor_profiles_admin_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only a call made through the API is held (the owner, SECURITY DEFINER functions and the server key are not). A tutor's own edit is held
  -- by guard_tutor_profiles; this is the same list for an admin's edit.
  if current_user not in ('authenticated', 'anon') or not public.is_active_admin() then
    return new;
  end if;
  if (new.id, new.created_at, new.current_tier_id, new.current_sub_tier_id, new.credential_floor_sub_tier_id, new.total_completed_hours,
      new.avg_rating, new.total_reviews_count, new.repeat_student_rate_pct, new.avg_grade_uplift_pct, new.qualified_uplift_students_count,
      new.total_sessions_completed, new.fast_track_status)
     is distinct from
     (old.id, old.created_at, old.current_tier_id, old.current_sub_tier_id, old.credential_floor_sub_tier_id, old.total_completed_hours,
      old.avg_rating, old.total_reviews_count, old.repeat_student_rate_pct, old.avg_grade_uplift_pct, old.qualified_uplift_students_count,
      old.total_sessions_completed, old.fast_track_status) then
    raise exception 'Level, hours, rating and review figures are worked out by Tutorlage; use Assign a level on the tutor''s page'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tutor_profiles_admin_columns() from public, anon, authenticated;

drop trigger if exists tutor_profiles_admin_columns on public.tutor_profiles;
create trigger tutor_profiles_admin_columns
  before update on public.tutor_profiles
  for each row execute function public.tutor_profiles_admin_columns();

-- ---- subject_candidates --------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins update subject candidates" on public.subject_candidates;
