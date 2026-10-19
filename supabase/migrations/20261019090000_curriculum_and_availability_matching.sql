-- Curriculum approval and calendar matching (CEO, 19 Oct 2026). Test: supabase/tests/curriculum_availability_matching.sql.
--
-- What the CEO asked for: a tutor declares the curriculum and subject they teach, an admin approves it against criteria, and a learner
-- is only matched with tutors approved for the curriculum their school follows; the request page gets a calendar and a length, and the
-- date and length decide which tutors are free, checked again when a tutor accepts.
--
-- ONE rule per idea, used by every path (the price counts, the tutor's inbox, the live accept, the older accept, a "book again" request
-- and the waiting list):
--   * tutor_qualify_problem()  a tutor teaches this: an APPROVED subject (any subject name containing what was typed, as the price
--                              counts always did), inside their grade range, for the curriculum the learner follows. Returns null when
--                              fine, else why.
--   * tutor_free_problem()     a tutor is free for this: the whole window inside their weekly working hours (South African time; no
--                              hours at all = not available; neighbouring blocks join) and no other session or accept in progress
--                              overlapping it.
--   * request_fit_code()       both of the above for one request and one tutor.
-- The price counts (available_price_levels) take an optional start, length and curriculum; the waiting list asks the same function
-- without a time, so it needs no change of its own.
--
-- REPLACED (same name, same signature, same permissions): claim_session_request, accept_session_request, available_requests_for_tutor,
--   guard_tutor_subject_verification.
-- REPLACED (new signature; the old three-argument one is dropped, an old caller that sends only three values still works because the
--   new ones have defaults): available_price_levels.
-- NEW tables: institution_curricula (extra curricula a school follows), curriculum_criteria (the approval checklist, edited in the admin
--   app), tutor_subject_reviews (the admin's note and ticks per subject: private, readable only by admins and the tutor who owns the
--   subject; kept out of tutor_subject_competencies because the public can read approved rows of that one).
--   NEW column: session_requests.curriculum_id. NEW policy: admins read all
--   subjects (they could only see verified ones). NEW triggers: guard_session_request_fit (length, curriculum, "book again" fit).
-- NOT touched: the waiting-list trigger functions (they call available_price_levels), create_session_from_request, the request-insert guard.
--
-- Subjects tutors already hold stay as they are (the ten verified rows). From now on a tutor can only add a subject as pending and an
-- admin approves it; the setting require_subject_verification is no longer read.

-- ---------------------------------------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.institution_curricula (
  institution_id uuid not null references public.schools_institutions(id) on delete cascade,
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (institution_id, curriculum_id)
);
alter table public.institution_curricula enable row level security;
drop policy if exists "Anyone can read the curricula a school follows" on public.institution_curricula;
create policy "Anyone can read the curricula a school follows" on public.institution_curricula for select using (true);
revoke insert, update, delete on public.institution_curricula from anon, authenticated;
grant select on public.institution_curricula to anon, authenticated;

create table if not exists public.curriculum_criteria (
  id uuid primary key default gen_random_uuid(),
  curriculum public.curriculum_type not null,
  sort_order integer not null default 0,
  criterion text not null check (length(btrim(criterion)) between 3 and 300),
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists curriculum_criteria_curriculum_idx on public.curriculum_criteria (curriculum, sort_order);
alter table public.curriculum_criteria enable row level security;
drop policy if exists "Admins read curriculum criteria" on public.curriculum_criteria;
create policy "Admins read curriculum criteria" on public.curriculum_criteria for select using (public.is_active_admin());
revoke insert, update, delete on public.curriculum_criteria from anon, authenticated;
grant select on public.curriculum_criteria to authenticated;      -- the policy above lets only admins see any row

-- Starting wording for the checklist, to be confirmed and edited by the CEO in the admin app. Only added when the table is empty.
insert into public.curriculum_criteria (curriculum, sort_order, criterion, required)
select v.curriculum::public.curriculum_type, v.sort_order, v.criterion, v.required
from (values
  ('caps', 1, 'Proof is on file that covers this subject: a matric certificate, a university transcript or a teaching qualification.', true),
  ('caps', 2, 'Passed this subject at Grade 12 with 70% or more, or studied it at university.', true),
  ('caps', 3, 'The grades chosen are reasonable for what the proof shows.', true),
  ('caps', 4, 'Knows the CAPS topics for those grades (from a teaching qualification, or the review call).', false),
  ('ieb', 1, 'Proof is on file that covers this subject: a matric certificate, a university transcript or a teaching qualification.', true),
  ('ieb', 2, 'Passed this subject in the IEB National Senior Certificate with 70% or more, or has taught or marked the IEB version of it.', true),
  ('ieb', 3, 'Knows how IEB papers differ from the national papers (the depth and the exam style).', true),
  ('ieb', 4, 'The grades chosen are reasonable for what the proof shows.', true),
  ('cambridge', 1, 'Proof is on file that covers this subject: a Cambridge certificate, a university transcript or a teaching qualification.', true),
  ('cambridge', 2, 'Passed this subject at IGCSE or A-Level with a B or better, or has taught or marked it.', true),
  ('cambridge', 3, 'Knows the Cambridge syllabus and paper structure for the levels chosen.', true),
  ('cambridge', 4, 'The grades chosen are reasonable for what the proof shows.', true)
) as v(curriculum, sort_order, criterion, required)
where not exists (select 1 from public.curriculum_criteria);

-- The admin's note and ticks for a subject. They live in their own table, NOT on tutor_subject_competencies: that table is readable by the
-- public for approved rows (policy "Public can view verified tutor competencies", and anon holds the table-level SELECT), so a column
-- there would publish the notes. Only admins and the tutor who owns the subject can read a row; nothing is granted to anon, and nobody
-- writes it directly (admin_review_tutor_subject does, as the table's owner).
create table if not exists public.tutor_subject_reviews (
  competency_id uuid primary key references public.tutor_subject_competencies(id) on delete cascade,
  reviewed_by uuid,
  reviewed_at timestamptz not null default now(),
  review_note text,
  criteria_met uuid[] not null default '{}'
);
alter table public.tutor_subject_reviews enable row level security;
drop policy if exists "Admins read subject reviews" on public.tutor_subject_reviews;
create policy "Admins read subject reviews" on public.tutor_subject_reviews for select using (public.is_active_admin());
drop policy if exists "Tutors read the review of their own subjects" on public.tutor_subject_reviews;
create policy "Tutors read the review of their own subjects" on public.tutor_subject_reviews for select
  using (exists (select 1 from public.tutor_subject_competencies c
                  where c.id = tutor_subject_reviews.competency_id and c.tutor_id = auth.uid()));
revoke all on public.tutor_subject_reviews from anon, authenticated;
grant select on public.tutor_subject_reviews to authenticated;

-- Admins could only ever see the verified subjects (and a tutor their own); the approvals queue needs all of them. Limited to signed-in
-- users: anon cannot run is_active_admin(), and a policy that calls it would make every signed-out read of this table fail (found by
-- the rolled-back test, check M56a, 19 Oct 2026).
drop policy if exists "Admins read all tutor competencies" on public.tutor_subject_competencies;
create policy "Admins read all tutor competencies" on public.tutor_subject_competencies for select to authenticated using (public.is_active_admin());

-- Which curriculum the learner follows, when their school follows more than one. Empty = any of the school's.
alter table public.session_requests add column if not exists curriculum_id uuid references public.curricula(id);

-- ---------------------------------------------------------------------------------------------------------
-- The curricula a school follows: its own (schools_institutions.curriculum_id) plus any added in the admin app
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.school_curricula(p_institution uuid)
returns table (curriculum_id uuid, code text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.code, c.name
  from public.curricula c
  where p_institution is not null
    and (
      exists (select 1 from public.schools_institutions s
               where s.id = p_institution
                 and (s.curriculum_id = c.id or (s.curriculum_id is null and c.code = upper(s.curriculum::text))))
      or exists (select 1 from public.institution_curricula ic
                  where ic.institution_id = p_institution and ic.curriculum_id = c.id)
    )
  order by c.name;
$$;
grant execute on function public.school_curricula(uuid) to anon, authenticated;

-- A tutor approved under CAPS also teaches primary-school CAPS; one approved under "other" covers every curriculum not named by the
-- five others (IB, American, British, Australian ...). The rest must match exactly.
create or replace function public.curriculum_covers(p_tutor public.curriculum_type, p_code text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_code) = p_tutor::text
      or (p_tutor = 'caps' and upper(p_code) = 'PRIMARY_CAPS')
      or (p_tutor = 'other' and upper(p_code) not in ('CAPS', 'PRIMARY_CAPS', 'IEB', 'CAMBRIDGE', 'TERTIARY'));
$$;
revoke all on function public.curriculum_covers(public.curriculum_type, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Rule 1: does this tutor teach this? null = yes, else 'no_subject', 'not_approved', 'wrong_grade' or 'wrong_curriculum'
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.tutor_qualify_problem(
  p_tutor uuid, p_subject text, p_grade text, p_institution uuid, p_curriculum uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject text := lower(btrim(coalesce(p_subject, '')));
  v_target integer;
  v_codes text[];
begin
  if v_subject = '' then
    return null;          -- no subject asked for: nothing to check
  end if;
  if not exists (select 1 from public.tutor_subject_competencies c
                  where c.tutor_id = p_tutor and position(v_subject in lower(c.subject_name)) > 0) then
    return 'no_subject';
  end if;
  if not exists (select 1 from public.tutor_subject_competencies c
                  where c.tutor_id = p_tutor and position(v_subject in lower(c.subject_name)) > 0
                    and c.verification_status = 'verified') then
    return 'not_approved';
  end if;

  -- A grade that is not in the list is not checked (the page tells the person it does not recognise it).
  select g.sort_order into v_target from public.grade_levels g where lower(g.name) = lower(btrim(coalesce(p_grade, '')));
  if v_target is not null and not exists (
    select 1 from public.tutor_subject_competencies c
    join public.grade_levels gmin on lower(gmin.name) = lower(c.min_grade_level)
    join public.grade_levels gmax on lower(gmax.name) = lower(c.max_grade_level)
    where c.tutor_id = p_tutor and position(v_subject in lower(c.subject_name)) > 0
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
    where c.tutor_id = p_tutor and position(v_subject in lower(c.subject_name)) > 0
      and c.verification_status = 'verified'
      and (v_target is null or v_target between gmin.sort_order and gmax.sort_order)
      and exists (select 1 from unnest(v_codes) code where public.curriculum_covers(c.curriculum, code))
  ) then
    return 'wrong_curriculum';
  end if;
  return null;
end;
$$;
revoke all on function public.tutor_qualify_problem(uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.tutor_qualifies(
  p_tutor uuid, p_subject text, p_grade text, p_institution uuid, p_curriculum uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tutor_qualify_problem(p_tutor, p_subject, p_grade, p_institution, p_curriculum) is null;
$$;
revoke all on function public.tutor_qualifies(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Rule 2: is this tutor free? null = yes, else 'no_hours', 'outside_hours' or 'busy'
-- ---------------------------------------------------------------------------------------------------------
-- Does the tutor's working hours on one weekday cover [p_from, p_to) minutes after midnight? Blocks that touch or overlap join up:
-- the window is covered if its start, and the end of every block that ends inside it, falls inside some block.
create or replace function public.tutor_hours_cover(p_tutor uuid, p_dow integer, p_from numeric, p_to numeric)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from (
      select p_from as pt
      union
      select extract(epoch from a.end_time) / 60
        from public.tutor_availability a
       where a.tutor_id = p_tutor and a.day_of_week = p_dow
         and extract(epoch from a.end_time) / 60 > p_from and extract(epoch from a.end_time) / 60 < p_to
    ) pts
    where not exists (
      select 1 from public.tutor_availability b
       where b.tutor_id = p_tutor and b.day_of_week = p_dow
         and extract(epoch from b.start_time) / 60 <= pts.pt
         and extract(epoch from b.end_time) / 60 > pts.pt
    )
  );
$$;
revoke all on function public.tutor_hours_cover(uuid, integer, numeric, numeric) from public, anon, authenticated;

create or replace function public.tutor_free_problem(
  p_tutor uuid, p_start timestamptz, p_hours numeric, p_exclude_request uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_end timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_day date;
  v_from numeric;
  v_to numeric;
begin
  if p_start is null or p_hours is null or p_hours <= 0 then
    return null;          -- no time asked for: nothing to check
  end if;
  v_end := p_start + (p_hours::float8 * interval '1 hour');

  if not exists (select 1 from public.tutor_availability a where a.tutor_id = p_tutor) then
    return 'no_hours';
  end if;

  -- Working hours are kept as plain clock times: they mean South African time. A window can touch two days.
  v_local_start := p_start at time zone 'Africa/Johannesburg';
  v_local_end := v_end at time zone 'Africa/Johannesburg';
  v_day := v_local_start::date;
  while v_day <= v_local_end::date loop
    v_from := case when v_day = v_local_start::date then extract(epoch from v_local_start::time) / 60 else 0 end;
    v_to := case when v_day = v_local_end::date then extract(epoch from v_local_end::time) / 60 else 1440 end;
    if v_to > v_from and not public.tutor_hours_cover(p_tutor, extract(dow from v_day)::integer, v_from, v_to) then
      return 'outside_hours';
    end if;
    v_day := v_day + 1;
  end loop;

  -- Another session of theirs, or a request they have just accepted and are being charged for, at the same time.
  if exists (
    select 1 from public.sessions s
     where s.tutor_id = p_tutor
       and s.status in ('pending_confirmation', 'scheduled', 'in_progress')
       and s.scheduled_start < v_end
       and s.scheduled_start + (s.duration_hours::float8 * interval '1 hour') > p_start
  ) then
    return 'busy';
  end if;
  if exists (
    select 1 from public.session_requests r
     where r.tutor_id = p_tutor and r.status = 'pending' and r.payment_status = 'charging'
       and r.id is distinct from p_exclude_request
       and greatest(r.requested_start, coalesce(r.claimed_at, r.requested_start)) < v_end
       and greatest(r.requested_start, coalesce(r.claimed_at, r.requested_start)) + (r.duration_hours::float8 * interval '1 hour') > p_start
  ) then
    return 'busy';
  end if;
  return null;
end;
$$;
revoke all on function public.tutor_free_problem(uuid, timestamptz, numeric, uuid) from public, anon, authenticated;

create or replace function public.tutor_free_for(p_tutor uuid, p_start timestamptz, p_hours numeric, p_exclude_request uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tutor_free_problem(p_tutor, p_start, p_hours, p_exclude_request) is null;
$$;
revoke all on function public.tutor_free_for(uuid, timestamptz, numeric, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Both rules for one request and one tutor. A request that starts "now" (or whose time has passed) is judged from this moment.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.request_fit_code(p_tutor uuid, p_request uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
  v_code text;
begin
  select r.institution_id, r.curriculum_id, r.requested_start, r.duration_hours, e.subject_name, e.grade_level
    into v
    from public.session_requests r
    left join public.student_subject_enrollments e on e.id = r.enrollment_id
   where r.id = p_request;
  if not found then
    return 'no_request';
  end if;
  v_code := public.tutor_qualify_problem(p_tutor, v.subject_name, v.grade_level, v.institution_id, v.curriculum_id);
  if v_code is not null then
    return v_code;
  end if;
  return public.tutor_free_problem(p_tutor, greatest(v.requested_start, now()), v.duration_hours, p_request);
end;
$$;
revoke all on function public.request_fit_code(uuid, uuid) from public, anon, authenticated;

-- What a tutor is told when they cannot take a request.
create or replace function public.tutor_fit_sentence(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_code
    when 'no_subject' then 'You don''t teach this subject yet.'
    when 'not_approved' then 'Tutorlage hasn''t approved this subject for you yet.'
    when 'wrong_grade' then 'This request is for a grade outside the range you teach.'
    when 'wrong_curriculum' then 'This request is for a curriculum you aren''t approved for.'
    when 'no_hours' then 'Set your weekly working hours before you accept requests.'
    when 'outside_hours' then 'This session is outside your weekly working hours.'
    when 'busy' then 'You already have a session at that time.'
    else 'Another tutor already accepted this request, or it is no longer available.'
  end;
$$;
revoke all on function public.tutor_fit_sentence(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- The price counts: the optional start, length and curriculum narrow who is counted
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.available_price_levels(
  p_subject text, p_grade text, p_institution uuid,
  p_start timestamptz default null, p_hours numeric default null, p_curriculum uuid default null
)
returns table(level_id character varying, tier_id integer, tier_name text, price numeric, currency_code text, tutors integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with eligible_tutors as (
    select tp.id, st.max_allowed_rate as tutor_rate
    from public.tutor_profiles tp
    join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
    where tp.is_verified
      and not (coalesce(tp.tier_frozen, false) and tp.freeze_reason is distinct from 'Average rating dropped below 4.70 threshold.')
      and (p_institution is null or tp.institution_id is null or tp.institution_id = p_institution)
      and public.tutor_qualifies(tp.id, p_subject, p_grade, p_institution, p_curriculum)
      and (p_start is null or p_hours is null or public.tutor_free_for(tp.id, p_start, p_hours))
  )
  select s.id, s.tier_id, t.public_name, s.max_allowed_rate, trim(t.currency_code),
         (select count(*)::integer from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  from public.sub_tier_definitions s
  join public.tier_definitions t on t.id = s.tier_id
  where s.id not in ('4C', '4D')
    and exists (select 1 from eligible_tutors e where e.tutor_rate >= s.max_allowed_rate)
  order by s.max_allowed_rate;
$function$;
drop function if exists public.available_price_levels(text, text, uuid);
grant execute on function public.available_price_levels(text, text, uuid, timestamptz, numeric, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- The tutor's inbox: only what the tutor could accept (the same rules the accept applies)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.available_requests_for_tutor()
returns table(id uuid, requested_start timestamptz, duration_hours numeric, enrollment_id uuid, charged_amount numeric,
              currency_code text, institution_id uuid, subject_name text, grade_level text, tier_id integer, tier_name text,
              level_id text, level_commission_pct numeric, sent_to_you boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
     -- institution (empty on either side matches), and a request that fits them (request_fit_code: an approved subject, grade and
     -- curriculum, inside their weekly hours and free of their other sessions).
     and (case when r.min_sub_tier_id is not null then s.max_allowed_rate <= ts.max_allowed_rate
               else r.tier_id is null or r.tier_id = tp.current_tier_id end)
     and (r.institution_id is null or tp.institution_id is null or r.institution_id = tp.institution_id)
     and public.request_fit_code(tp.id, r.id) is null
   order by r.requested_start;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- Accepting: the tutor's row is locked first, so two accepts by one tutor are judged one after the other, and the rules run again
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.claim_session_request(p_request_id uuid, p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tutor record;
  v_req record;
  v_fit text;
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
  where tp.id = p_tutor_id
  for update of tp;
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

  -- Checked again here, not only when the request was shown: an approved subject, grade and curriculum, and free at that time.
  v_fit := public.request_fit_code(p_tutor_id, p_request_id);
  if v_fit is not null then
    raise exception '%', public.tutor_fit_sentence(v_fit);
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

create or replace function public.accept_session_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tutor record;
  v_req record;
  v_fit text;
  v_commission numeric;
  v_level_rate numeric;
  v_session_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = v_uid
  for update of tp;
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

  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate, commission_rate_pct into v_level_rate, v_commission
    from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  else
    if v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
      raise exception 'This request is for a different pricing level.';
    end if;
  end if;
  if v_commission is null then
    select commission_rate_pct into v_commission from public.tier_definitions where id = coalesce(v_req.tier_id, v_tutor.current_tier_id);
  end if;

  if v_req.institution_id is not null and v_tutor.institution_id is not null
     and v_req.institution_id <> v_tutor.institution_id then
    raise exception 'This request is for a different institution.';
  end if;

  v_fit := public.request_fit_code(v_uid, p_request_id);
  if v_fit is not null then
    raise exception '%', public.tutor_fit_sentence(v_fit);
  end if;

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
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- A subject can only be approved by Tutorlage (the guard used to do nothing unless a setting was on, and the setting was off)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.guard_tutor_subject_verification()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status then
    raise exception 'Only Tutorlage can verify a subject' using errcode = '42501';
  end if;
  -- Changing what was approved (the subject, curriculum or grades) sends it back for approval.
  if (new.subject_name, new.curriculum, new.min_grade_level, new.max_grade_level)
     is distinct from (old.subject_name, old.curriculum, old.min_grade_level, old.max_grade_level) then
    new.verification_status := 'pending';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- A new request: a session lasts 1 to 3 hours in half-hours, the curriculum chosen is one of the school's, and a request
-- addressed to a tutor ("book again") must fit that tutor
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.addressed_fit_problem(
  p_student uuid, p_requested_by uuid, p_tutor uuid, p_enrollment uuid, p_institution uuid, p_curriculum uuid,
  p_start timestamptz, p_hours numeric
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_grade text;
  v_code text;
begin
  -- Same caller checks as addressed_request_problem, and only for a tutor this learner has had: nobody can use this to look at other tutors.
  if auth.uid() is null or auth.uid() is distinct from p_requested_by or p_student is null or not public.can_book_for(p_student)
     or not exists (select 1 from public.sessions where student_id = p_student and tutor_id = p_tutor and status = 'completed') then
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
    return 'This tutor isn''t free at that time. Choose another time, or send the request to any available tutor.';
  end if;
  return null;
end;
$$;
revoke all on function public.addressed_fit_problem(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, numeric) from public, anon;
grant execute on function public.addressed_fit_problem(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, numeric) to authenticated;

create or replace function public.guard_session_request_fit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_problem text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.duration_hours is null or new.duration_hours < 1 or new.duration_hours > 3
     or (new.duration_hours * 2) <> trunc(new.duration_hours * 2) then
    raise exception 'A session lasts from 1 to 3 hours, in half-hour steps.';
  end if;
  if new.curriculum_id is not null and (
       new.institution_id is null
       or not exists (select 1 from public.school_curricula(new.institution_id) sc where sc.curriculum_id = new.curriculum_id)
     ) then
    raise exception 'That curriculum isn''t one this school follows.';
  end if;
  if new.requested_tutor_id is not null then
    v_problem := public.addressed_fit_problem(new.student_id, new.requested_by_profile_id, new.requested_tutor_id,
                                              new.enrollment_id, new.institution_id, new.curriculum_id,
                                              new.requested_start, new.duration_hours);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_session_request_fit on public.session_requests;
create trigger guard_session_request_fit before insert on public.session_requests
  for each row execute function public.guard_session_request_fit();

-- ---------------------------------------------------------------------------------------------------------
-- Admin: approve or reject a subject, the checklist, and the curricula of a school. Each checks the caller and writes the audit row.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_review_tutor_subject(
  p_competency uuid, p_decision text, p_reason text, p_criteria uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_missing integer;
  v_unknown integer;
  v_has_criteria boolean;
  v_label text;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select * into c from public.tutor_subject_competencies where id = p_competency for update;
  if not found then
    raise exception 'No such subject';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject';
  end if;
  v_label := c.subject_name || ' (' || upper(replace(c.curriculum::text, '_', ' ')) || ', ' || c.min_grade_level || ' to ' || c.max_grade_level || ')';

  if p_decision = 'approve' then
    select exists (select 1 from public.curriculum_criteria where curriculum = c.curriculum and active) into v_has_criteria;
    select count(*) into v_missing
      from public.curriculum_criteria k
     where k.curriculum = c.curriculum and k.active and k.required and not (k.id = any (coalesce(p_criteria, '{}')));
    if v_missing > 0 then
      raise exception 'Tick every required criterion before approving (% left)', v_missing;
    end if;
    select count(*) into v_unknown
      from unnest(coalesce(p_criteria, '{}')) as picked(id)
     where not exists (select 1 from public.curriculum_criteria k where k.id = picked.id and k.curriculum = c.curriculum);
    if v_unknown > 0 then
      raise exception 'A ticked criterion does not belong to this curriculum';
    end if;
    if not v_has_criteria and coalesce(length(v_reason), 0) < 3 then
      raise exception 'There is no checklist for this curriculum yet. Write a note saying what you checked.';
    end if;
    update public.tutor_subject_competencies
       set verification_status = 'verified', updated_at = now()
     where id = p_competency;
    insert into public.tutor_subject_reviews (competency_id, reviewed_by, reviewed_at, review_note, criteria_met)
    values (p_competency, auth.uid(), now(), v_reason, coalesce(p_criteria, '{}'))
    on conflict (competency_id) do update
      set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
          review_note = excluded.review_note, criteria_met = excluded.criteria_met;
    insert into public.notifications (profile_id, type, title, body)
    values (c.tutor_id, 'subject_approved', 'Subject approved',
            v_label || ' is approved. Learners can now be matched with you for it.');
    perform public.log_admin_event('tutor_approved', 'tutor_subject_competencies', p_competency,
      jsonb_build_object('kind', 'subject_approved', 'tutor_id', c.tutor_id, 'subject', c.subject_name,
                         'curriculum', c.curriculum, 'criteria_met', coalesce(p_criteria, '{}'), 'note', v_reason));
  else
    if coalesce(length(v_reason), 0) < 3 then
      raise exception 'Give the reason for not approving this subject';
    end if;
    update public.tutor_subject_competencies
       set verification_status = 'rejected', updated_at = now()
     where id = p_competency;
    insert into public.tutor_subject_reviews (competency_id, reviewed_by, reviewed_at, review_note, criteria_met)
    values (p_competency, auth.uid(), now(), v_reason, '{}')
    on conflict (competency_id) do update
      set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
          review_note = excluded.review_note, criteria_met = excluded.criteria_met;
    insert into public.notifications (profile_id, type, title, body)
    values (c.tutor_id, 'subject_rejected', 'Subject not approved',
            v_label || ' was not approved: ' || v_reason);
    perform public.log_admin_event('tutor_rejected', 'tutor_subject_competencies', p_competency,
      jsonb_build_object('kind', 'subject_rejected', 'tutor_id', c.tutor_id, 'subject', c.subject_name,
                         'curriculum', c.curriculum, 'reason', v_reason));
  end if;
end;
$$;

create or replace function public.admin_save_curriculum_criterion(
  p_id uuid, p_curriculum text, p_criterion text, p_required boolean, p_active boolean, p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_text text := btrim(coalesce(p_criterion, ''));
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if length(v_text) < 3 or length(v_text) > 300 then
    raise exception 'Write the criterion in 3 to 300 characters';
  end if;
  if p_id is null then
    insert into public.curriculum_criteria (curriculum, sort_order, criterion, required, active)
    values (p_curriculum::public.curriculum_type, coalesce(p_sort_order, 0), v_text, coalesce(p_required, true), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.curriculum_criteria
       set criterion = v_text, required = coalesce(p_required, required), active = coalesce(p_active, active),
           sort_order = coalesce(p_sort_order, sort_order), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No such criterion';
    end if;
  end if;
  perform public.log_admin_event('system_setting_updated', 'curriculum_criteria', v_id,
    jsonb_build_object('kind', 'curriculum_criterion', 'curriculum', p_curriculum, 'criterion', v_text,
                       'required', p_required, 'active', p_active));
  return v_id;
end;
$$;

create or replace function public.admin_delete_curriculum_criterion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  delete from public.curriculum_criteria where id = p_id returning * into c;
  if not found then
    raise exception 'No such criterion';
  end if;
  perform public.log_admin_event('system_setting_updated', 'curriculum_criteria', p_id,
    jsonb_build_object('kind', 'curriculum_criterion_deleted', 'curriculum', c.curriculum, 'criterion', c.criterion));
end;
$$;

-- The full list of curricula a school follows. Its own one (schools_institutions.curriculum_id) always stays; the rest are the extras.
create or replace function public.admin_set_institution_curricula(p_institution uuid, p_curricula uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own uuid;
  v_wanted uuid[];
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select s.curriculum_id into v_own from public.schools_institutions s where s.id = p_institution;
  if not found then
    raise exception 'No such school';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_wanted
    from unnest(coalesce(p_curricula, '{}')) x
   where x is distinct from v_own;
  if exists (select 1 from unnest(v_wanted) x where not exists (select 1 from public.curricula where id = x)) then
    raise exception 'One of those curricula does not exist';
  end if;
  delete from public.institution_curricula where institution_id = p_institution and not (curriculum_id = any (v_wanted));
  insert into public.institution_curricula (institution_id, curriculum_id)
  select p_institution, x from unnest(v_wanted) x
  on conflict do nothing;
  perform public.log_admin_event('system_setting_updated', 'schools_institutions', p_institution,
    jsonb_build_object('kind', 'institution_curricula', 'curricula', v_wanted));
end;
$$;

revoke all on function public.admin_review_tutor_subject(uuid, text, text, uuid[]) from public, anon;
revoke all on function public.admin_save_curriculum_criterion(uuid, text, text, boolean, boolean, integer) from public, anon;
revoke all on function public.admin_delete_curriculum_criterion(uuid) from public, anon;
revoke all on function public.admin_set_institution_curricula(uuid, uuid[]) from public, anon;
grant execute on function public.admin_review_tutor_subject(uuid, text, text, uuid[]) to authenticated;
grant execute on function public.admin_save_curriculum_criterion(uuid, text, text, boolean, boolean, integer) to authenticated;
grant execute on function public.admin_delete_curriculum_criterion(uuid) to authenticated;
grant execute on function public.admin_set_institution_curricula(uuid, uuid[]) to authenticated;
