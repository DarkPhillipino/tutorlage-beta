-- 2026-11-19, J3 (prior hours, PM start brief 2). NOT APPLIED: waits for the PM's written line.
-- Why: the platform counts hours only from completed Tutorlage sessions (sessions.duration_hours, summed by fn_recalculate_tutor_tier). A tutor who has taught
-- elsewhere (a student teacher with about 300 hours, another with some) therefore shows 0. An admin can now record HOURS TAUGHT OUTSIDE TUTORLAGE for a tutor, each
-- with a reason and a REQUIRED proof reference (a letter, a school's confirmation), who and when; every entry and every removal leaves one audit event; an entry is
-- never edited (it can only be removed, with a reason, and stays on the record).
-- What it changes, exactly:
--   1. NEW table public.tutor_prior_hours (row level security on, NO policy and NO right for any API role: only the functions below touch it).
--   2. NEW functions admin_add_prior_hours, admin_remove_prior_hours, admin_prior_hours_for_tutor (verification officer or super admin, the same roles as recording a
--      credential) and tutor_prior_hours_total (the tutor reads her own total, an admin anyone's; nobody else).
--   3. REPLACES the one existing function public.fn_recalculate_tutor_tier(uuid) (md5 of its definition on production on 18 Nov: 63cd2be556ebce6c7c095fba001dec67) with
--      the SAME text plus a few lines: it sums the tutor's un-removed prior hours into v_prior, and the HOURS criterion (min_hours) is compared with completed Tutorlage
--      hours + prior hours. total_completed_hours keeps meaning Tutorlage hours only; the other five criteria and the credential floor are untouched.
--      The old text is saved in Drake/programmer/rollbacks/20261119010000_tutor_prior_hours_ROLLBACK.sql.
-- What it does NOT do: a level is the highest at which ALL SIX criteria are met (hours, rating, repeat rate, written reviews, grade uplift, distinct students) OR the
-- credential floor. So prior hours with no reviews on Tutorlage do not raise a level by themselves; they only stop the hours criterion from being the missing one.
-- No tutor's level changes when this is applied (no entries exist yet).

create table if not exists public.tutor_prior_hours (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  hours numeric(8, 2) not null check (hours > 0 and hours <= 5000),
  reason text not null check (char_length(btrim(reason)) >= 10),
  proof_reference text not null check (char_length(btrim(proof_reference)) >= 5),
  added_by uuid not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  removal_reason text,
  check ((removed_at is null and removed_by is null and removal_reason is null)
      or (removed_at is not null and removed_by is not null and char_length(btrim(removal_reason)) >= 10))
);
create index if not exists tutor_prior_hours_tutor_idx on public.tutor_prior_hours (tutor_id) where removed_at is null;
alter table public.tutor_prior_hours enable row level security;
revoke all on table public.tutor_prior_hours from public, anon, authenticated, service_role;

create or replace function public.admin_add_prior_hours(p_tutor uuid, p_hours numeric, p_reason text, p_proof text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can record prior hours' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 5000 then
    raise exception 'Hours must be more than 0 and at most 5000';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say where and when the hours were taught (at least 10 characters)';
  end if;
  if char_length(btrim(coalesce(p_proof, ''))) < 5 then
    raise exception 'A proof reference is required (for example a letter or a school confirmation)';
  end if;
  insert into public.tutor_prior_hours (tutor_id, hours, reason, proof_reference, added_by)
  values (p_tutor, round(p_hours, 2), btrim(p_reason), btrim(p_proof), auth.uid())
  returning id into v_id;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'add_prior_hours', 'entry', v_id, 'hours', round(p_hours, 2), 'proof_reference', btrim(p_proof)));
  perform public.fn_recalculate_tutor_tier(p_tutor);
  return v_id;
end;
$$;

create or replace function public.admin_remove_prior_hours(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tutor_prior_hours%rowtype;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can remove prior hours' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  select * into v_row from public.tutor_prior_hours where id = p_id for update;
  if not found then
    raise exception 'No such entry';
  end if;
  if v_row.removed_at is not null then
    raise exception 'That entry was already removed';
  end if;
  update public.tutor_prior_hours set removed_at = now(), removed_by = auth.uid(), removal_reason = btrim(p_reason) where id = p_id;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', v_row.tutor_id,
    jsonb_build_object('action', 'remove_prior_hours', 'entry', p_id, 'hours', v_row.hours, 'reason', btrim(p_reason)));
  perform public.fn_recalculate_tutor_tier(v_row.tutor_id);
end;
$$;

-- The entries for one tutor, newest first, for the admin's Level card (who added them is shown by name).
create or replace function public.admin_prior_hours_for_tutor(p_tutor uuid)
returns table (id uuid, hours numeric, reason text, proof_reference text, added_by_name text, added_at timestamptz, removed_at timestamptz, removal_reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can see prior hours' using errcode = '42501';
  end if;
  return query
    select h.id, h.hours, h.reason, h.proof_reference,
           coalesce(nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.surname, '')), ''), 'an admin'),
           h.added_at, h.removed_at, h.removal_reason
      from public.tutor_prior_hours h
      left join public.admin_profiles a on a.id = h.added_by
     where h.tutor_id = p_tutor
     order by h.added_at desc;
end;
$$;

-- The un-removed total, for the tutor's own screen ("hours outside Tutorlage") and for an admin. Nobody else.
create or replace function public.tutor_prior_hours_total(p_tutor uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not (auth.uid() = p_tutor or public.is_active_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return (select coalesce(sum(hours), 0) from public.tutor_prior_hours where tutor_id = p_tutor and removed_at is null);
end;
$$;

revoke all on function public.admin_add_prior_hours(uuid, numeric, text, text) from public, anon;
revoke all on function public.admin_remove_prior_hours(uuid, text) from public, anon;
revoke all on function public.admin_prior_hours_for_tutor(uuid) from public, anon;
revoke all on function public.tutor_prior_hours_total(uuid) from public, anon;
grant execute on function public.admin_add_prior_hours(uuid, numeric, text, text) to authenticated;
grant execute on function public.admin_remove_prior_hours(uuid, text) to authenticated;
grant execute on function public.admin_prior_hours_for_tutor(uuid) to authenticated;
grant execute on function public.tutor_prior_hours_total(uuid) to authenticated;

-- The existing function, replaced (same signature, same grants): the lines marked with "prior hours" / v_prior / v_tier_hours are the only additions.
create or replace FUNCTION public.fn_recalculate_tutor_tier(p_tutor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_rating_freeze constant text := 'Average rating dropped below 4.70 threshold.';
  v_completed_hours numeric(10, 2);
  v_prior numeric(10, 2);       -- hours an admin recorded from teaching outside Tutorlage (tutor_prior_hours); counted for the HOURS criterion only
  v_tier_hours numeric(10, 2);
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

  select coalesce(sum(hours), 0) into v_prior from public.tutor_prior_hours where tutor_id = p_tutor_id and removed_at is null;
  v_tier_hours := v_completed_hours + v_prior;

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
      return;
    end if;
  end if;

  select id, tier_id, max_allowed_rate into v_earned
  from public.sub_tier_definitions
  where min_hours <= v_tier_hours
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
$function$
;
