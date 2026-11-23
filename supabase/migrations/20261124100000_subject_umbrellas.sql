-- 2026-11-24, JOB Q-FIX (PM line 53, CEO): UMBRELLA SUBJECTS IN MATCHING, as admin-editable data.
-- WHY: a request for History or Geography never reached a tutor approved only for Social Sciences, and the same for Natural Sciences, Technology, Physical Sciences and Life Sciences
-- under Natural Sciences and Technology (job Q, section 5 of the 23 Nov report). The matching rule (tutor_qualify_problem) asks whether the REQUESTED name is contained in the tutor's
-- approved name. THE SUBSTRING RULE IS NOT CHANGED: everything that matched before still matches. This adds ONE more way to match:
--   a tutor approved for an UMBRELLA covers a requested PART when the table subject_umbrellas says so and the request's grade is not past the row's last_grade.
-- Starting rows (the CEO): Social Sciences covers Geography and History up to Grade 7; Natural Sciences and Technology covers Natural Sciences, Technology, Physical Sciences and Life Sciences
-- up to Grade 7. For Grades 8 and 9 a tutor must be approved for the part itself. A request whose grade is empty or not in the list is not limited by last_grade (the grade is not checked anywhere else
-- for such a request either); the tutor's own approved grade range is still checked as before.
-- THE ONE HELPER: subject_covers(requested, approved_name, grade). tutor_qualify_problem uses it in its four subject-name tests, so the request picker's no_tutor_reason, the tutor's request list
-- (request_fit_code) and claim_session_request all follow at once. The admin coverage view counts umbrella supply under the parts.
-- ADMIN-EDITABLE: the table can be read and changed only by a super admin through admin_list_subject_umbrellas / admin_set_subject_umbrella / admin_remove_subject_umbrella (each change audited).
-- Rollback: Drake/programmer/rollbacks/20261124100000_subject_umbrellas_ROLLBACK.sql. Test: supabase/tests/subject_umbrellas.sql.

create table if not exists public.subject_umbrellas (
  umbrella text not null,
  part text not null,
  last_grade text,
  primary key (umbrella, part),
  constraint subject_umbrellas_not_blank check (btrim(umbrella) <> '' and btrim(part) <> '' and lower(btrim(umbrella)) <> lower(btrim(part)))
);
alter table public.subject_umbrellas enable row level security;
revoke all on table public.subject_umbrellas from public, anon, authenticated, service_role;

insert into public.subject_umbrellas (umbrella, part, last_grade) values
  ('Social Sciences', 'Geography', 'Grade 7'),
  ('Social Sciences', 'History', 'Grade 7'),
  ('Natural Sciences and Technology', 'Natural Sciences', 'Grade 7'),
  ('Natural Sciences and Technology', 'Technology', 'Grade 7'),
  ('Natural Sciences and Technology', 'Physical Sciences', 'Grade 7'),
  ('Natural Sciences and Technology', 'Life Sciences', 'Grade 7')
on conflict (umbrella, part) do nothing;

-- the one helper
create or replace function public.subject_covers(p_requested text, p_approved text, p_grade text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select position(lower(btrim(coalesce(p_requested, ''))) in lower(coalesce(p_approved, ''))) > 0
      or exists (
           select 1 from public.subject_umbrellas u
            where lower(btrim(u.umbrella)) = lower(btrim(coalesce(p_approved, '')))
              and lower(btrim(u.part)) = lower(btrim(coalesce(p_requested, '')))
              and (u.last_grade is null
                   or not exists (select 1 from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(p_grade, ''))))
                   or (select g.sort_order from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(p_grade, ''))))
                      <= coalesce((select l.sort_order from public.grade_levels l where lower(l.name) = lower(btrim(u.last_grade))), 2147483647)));
$$;
revoke all on function public.subject_covers(text, text, text) from public, anon, authenticated, service_role;

-- admin: read, set, remove (super admin only; every change audited; no personal data)
create or replace function public.admin_list_subject_umbrellas()
returns table (umbrella text, part text, last_grade text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Only a super admin can see the subject umbrellas' using errcode = '42501';
  end if;
  return query select u.umbrella, u.part, u.last_grade from public.subject_umbrellas u order by u.umbrella, u.part;
end;
$$;
revoke all on function public.admin_list_subject_umbrellas() from public, anon;
grant execute on function public.admin_list_subject_umbrellas() to authenticated;

create or replace function public.admin_set_subject_umbrella(p_umbrella text, p_part text, p_last_grade text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u text := btrim(coalesce(p_umbrella, ''));
  v_p text := btrim(coalesce(p_part, ''));
  v_g text := nullif(btrim(coalesce(p_last_grade, '')), '');
begin
  if not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Only a super admin can change the subject umbrellas' using errcode = '42501';
  end if;
  if v_u = '' or v_p = '' or lower(v_u) = lower(v_p) then
    raise exception 'Give the umbrella subject and a different part';
  end if;
  if v_g is not null then
    select g.name into v_g from public.grade_levels g where lower(g.name) = lower(v_g);
    if v_g is null then raise exception 'That last grade is not in the grade list'; end if;
  end if;
  insert into public.subject_umbrellas (umbrella, part, last_grade) values (v_u, v_p, v_g)
  on conflict (umbrella, part) do update set last_grade = excluded.last_grade;
  perform public.log_admin_event('system_setting_updated', 'subject_umbrellas', md5(lower(v_u) || '/' || lower(v_p))::uuid, jsonb_build_object('kind', 'subject_umbrella_set', 'umbrella', v_u, 'part', v_p, 'last_grade', v_g));
end;
$$;
revoke all on function public.admin_set_subject_umbrella(text, text, text) from public, anon;
grant execute on function public.admin_set_subject_umbrella(text, text, text) to authenticated;

create or replace function public.admin_remove_subject_umbrella(p_umbrella text, p_part text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Only a super admin can change the subject umbrellas' using errcode = '42501';
  end if;
  delete from public.subject_umbrellas where lower(btrim(umbrella)) = lower(btrim(coalesce(p_umbrella, ''))) and lower(btrim(part)) = lower(btrim(coalesce(p_part, '')));
  perform public.log_admin_event('system_setting_updated', 'subject_umbrellas', md5(lower(btrim(coalesce(p_umbrella, ''))) || '/' || lower(btrim(coalesce(p_part, ''))))::uuid, jsonb_build_object('kind', 'subject_umbrella_removed', 'umbrella', btrim(p_umbrella), 'part', btrim(p_part)));
end;
$$;
revoke all on function public.admin_remove_subject_umbrella(text, text) from public, anon;
grant execute on function public.admin_remove_subject_umbrella(text, text) to authenticated;

-- tutor_qualify_problem: the four subject-name tests now go through subject_covers (generated from the live definition of 24 Nov 2026; nothing else changed)
CREATE OR REPLACE FUNCTION public.tutor_qualify_problem(p_tutor uuid, p_subject text, p_grade text, p_institution uuid, p_curriculum uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_subject text := lower(btrim(coalesce(p_subject, '')));
  v_target integer;
  v_codes text[];
begin
  if v_subject = '' then
    return null;          -- no subject asked for: nothing to check
  end if;
  if not exists (select 1 from public.tutor_subject_competencies c
                  where c.tutor_id = p_tutor and public.subject_covers(v_subject, c.subject_name, p_grade)) then
    return 'no_subject';
  end if;
  if not exists (select 1 from public.tutor_subject_competencies c
                  where c.tutor_id = p_tutor and public.subject_covers(v_subject, c.subject_name, p_grade)
                    and c.verification_status = 'verified') then
    return 'not_approved';
  end if;

  -- A grade that is not in the list is not checked (the page tells the person it does not recognise it).
  select g.sort_order into v_target from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(p_grade, '')));
  if v_target is not null and not exists (
    select 1 from public.tutor_subject_competencies c
    join public.grade_levels gmin on lower(gmin.name) = lower(c.min_grade_level)
    join public.grade_levels gmax on lower(gmax.name) = lower(c.max_grade_level)
    where c.tutor_id = p_tutor and public.subject_covers(v_subject, c.subject_name, p_grade)
      and c.verification_status = 'verified'
      and v_target between gmin.sort_order and gmax.sort_order
  ) then
    return 'wrong_grade';
  end if;

  -- The curricula the request is for: the one the learner chose, else every one their school follows, else no restriction.
  if p_curriculum is not null then
    select array_agg(cu.code) into v_codes from public.curricula cu where cu.id = p_curriculum;
  elsif p_institution is not null then
    select array_agg(sc.code) into v_codes from public.school_curricula(p_institution) sc;
  end if;
  if v_codes is not null and not exists (
    select 1 from public.tutor_subject_competencies c
    left join public.grade_levels gmin on lower(gmin.name) = lower(c.min_grade_level)
    left join public.grade_levels gmax on lower(gmax.name) = lower(c.max_grade_level)
    where c.tutor_id = p_tutor and public.subject_covers(v_subject, c.subject_name, p_grade)
      and c.verification_status = 'verified'
      and (v_target is null or v_target between gmin.sort_order and gmax.sort_order)
      and exists (select 1 from unnest(v_codes) code where public.curriculum_covers(c.curriculum, code))
  ) then
    return 'wrong_curriculum';
  end if;
  return null;
end;
$function$;

-- admin_founding_coverage: umbrella supply counted under the parts (generated from the live definition; nothing else changed)
CREATE OR REPLACE FUNCTION public.admin_founding_coverage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the coverage view' using errcode = '42501';
  end if;
  return coalesce((
    with tutors as (
      select distinct c.subject_name as subject, x.phase, c.tutor_id
      from public.tutor_subject_competencies c
      join public.tutor_profiles t on t.id = c.tutor_id and t.is_verified
      cross join lateral unnest(public.founding_phases(c.min_grade_level, c.max_grade_level)) as x(phase)
      where c.verification_status = 'verified'
        and exists (select 1 from public.tutor_availability a where a.tutor_id = c.tutor_id)
      union
      -- UMBRELLA SUPPLY (24 Nov 2026): a tutor approved for an umbrella (Social Sciences, Natural Sciences and Technology) also counts under each of its parts,
      -- for the grades the mapping allows (her own range, cut at the umbrella's last grade)
      select distinct u.part as subject, x.phase, c.tutor_id
      from public.tutor_subject_competencies c
      join public.tutor_profiles t on t.id = c.tutor_id and t.is_verified
      join public.subject_umbrellas u on lower(btrim(u.umbrella)) = lower(btrim(c.subject_name))
      cross join lateral unnest(public.founding_phases(
        c.min_grade_level,
        coalesce((select g.name from public.grade_levels g where g.name in (c.max_grade_level, u.last_grade) order by g.sort_order limit 1), c.max_grade_level)
      )) as x(phase)
      where c.verification_status = 'verified'
        and exists (select 1 from public.tutor_availability a where a.tutor_id = c.tutor_id)
    ),
    hours as (
      select a.tutor_id, sum(extract(epoch from (a.end_time - a.start_time)) / 3600) as h
      from public.tutor_availability a group by a.tutor_id
    ),
    supply as (
      select tt.subject, tt.phase, count(*) as ready_tutors, round(coalesce(sum(h.h), 0)::numeric, 1) as weekly_hours
      from tutors tt left join hours h on h.tutor_id = tt.tutor_id
      group by tt.subject, tt.phase
    ),
    demand as (
      select e.subject_name as subject, public.founding_phase_of(e.grade_level) as phase,
        count(*) as received,
        count(*) filter (where r.status = 'accepted' or r.tutor_id is not null) as accepted,
        count(*) filter (where r.tutor_id is null and r.status = 'pending' and r.created_at < now() - interval '24 hours') as unserved,
        count(*) filter (where r.status = 'expired') as expired
      from public.session_requests r
      join public.student_subject_enrollments e on e.id = r.enrollment_id
      where r.created_at > now() - interval '30 days'
      group by e.subject_name, public.founding_phase_of(e.grade_level)
    ),
    people as (
      select f.id, f.status, f.user_id, f.email_key, f.subjects,
        (f.status = 'verified' or exists (
          select 1 from public.tutor_profiles tp
          where tp.is_verified and tp.id = coalesce(f.user_id, (select u.id from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key limit 1)))) as is_verified
      from public.founding_tutors_list f
      where f.source <> 'backfill' and coalesce(f.src, '') not like 'test%'
    ),
    entries as (
      select el ->> 'subject' as subject, x.phase,
        count(distinct p.id) as on_list,
        count(distinct p.id) filter (where p.status in ('released', 'signed_up')) as released,
        count(distinct p.id) filter (where p.is_verified) as verified
      from people p
      cross join lateral jsonb_array_elements(p.subjects) el
      cross join lateral unnest(public.founding_phases(el ->> 'min_grade', el ->> 'max_grade')) as x(phase)
      group by el ->> 'subject', x.phase
    ),
    keys as (
      select subject, phase from supply union select subject, phase from demand union select subject, phase from entries
    )
    select jsonb_agg(jsonb_build_object(
        'subject', k.subject, 'phase', k.phase,
        'on_list', coalesce(e.on_list, 0), 'released', coalesce(e.released, 0), 'verified', coalesce(e.verified, 0),
        'ready_tutors', coalesce(s.ready_tutors, 0), 'weekly_hours', coalesce(s.weekly_hours, 0),
        'requests', coalesce(d.received, 0), 'accepted', coalesce(d.accepted, 0), 'unserved_requests', coalesce(d.unserved, 0), 'expired', coalesce(d.expired, 0),
        'status', case when coalesce(s.ready_tutors, 0) >= 3 then 'OPEN' when coalesce(s.ready_tutors, 0) >= 1 then 'THIN' else 'EMPTY' end,
        'demand_no_supply', coalesce(d.received, 0) > 0 and coalesce(s.ready_tutors, 0) < 3)
      order by coalesce(d.unserved, 0) desc, coalesce(d.received, 0) desc, k.subject, k.phase)
    from keys k
    left join supply s on s.subject = k.subject and s.phase = k.phase
    left join demand d on d.subject = k.subject and d.phase = k.phase
    left join entries e on e.subject = k.subject and e.phase = k.phase
  ), '[]'::jsonb);
end;
$function$;

-- rights as before (create or replace keeps them; stated again so a reader sees them)
revoke all on function public.tutor_qualify_problem(uuid, text, text, uuid, uuid) from public, anon;
