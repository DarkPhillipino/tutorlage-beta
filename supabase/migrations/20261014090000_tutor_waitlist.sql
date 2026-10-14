-- Master 7cz: "Tell me when a tutor is available" (the CEO agreed on 14 Oct 2026).
--
-- WHY: a learner whose subject and grade have no approved tutor yet sees "No tutor can take this request yet" and has
-- nothing to do. This lets them (or their parent) ask to be told, so early demand is not lost, and it gives the team
-- a count of unmet demand by subject and grade.
--
-- WHAT THIS DOES (nothing existing is replaced: no function, no trigger, no policy):
--  1. tutor_waitlist: one row per "tell me" request: which learner, which subject and grade (and optionally which
--     school), who asked (the learner, or the parent who looks after them), and when they were told.
--     It stores NO contact details: the person is told through the in-app notification on their own account.
--  2. join_tutor_waitlist(...) and leave_tutor_waitlist(...): the only ways to write the table. Joining is refused if a
--     tutor is already available (the same rule the app uses, available_price_levels), if the caller may not book for
--     that learner (can_book_for), or if the caller already has 10 open entries.
--  3. notify_tutor_waitlist(): runs when a tutor becomes approved, or a tutor's subject becomes verified. For every open
--     entry that now has an available tutor (again by available_price_levels), it adds ONE notification and marks the entry told.
--  4. purge_old_tutor_waitlist(): removes entries 90 days after they were told or made, run daily (pg_cron).
--  Entries older than 60 days are not told (they have expired); the owner can join again.
--
-- Reads: a person sees their own entries; active admins see all (the count of unmet demand). Writes: only the functions.

-- ---- 1. the list -------------------------------------------------------------------------------------------------
create table if not exists public.tutor_waitlist (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (length(btrim(subject)) between 1 and 100),
  grade_level text check (grade_level is null or length(btrim(grade_level)) between 1 and 50),
  institution_id uuid references public.schools_institutions (id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

-- One open entry per person, learner, subject, grade and school (case and spaces ignored).
create unique index if not exists tutor_waitlist_open_once on public.tutor_waitlist (
  requested_by,
  student_id,
  lower(btrim(subject)),
  coalesce(lower(btrim(grade_level)), ''),
  coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where notified_at is null;

create index if not exists tutor_waitlist_open_created on public.tutor_waitlist (created_at) where notified_at is null;

alter table public.tutor_waitlist enable row level security;

drop policy if exists "Read own waiting-list entries" on public.tutor_waitlist;
create policy "Read own waiting-list entries" on public.tutor_waitlist
  for select to authenticated using (requested_by = auth.uid());

drop policy if exists "Admins read the waiting list" on public.tutor_waitlist;
create policy "Admins read the waiting list" on public.tutor_waitlist
  for select to authenticated using (public.is_active_admin());

-- Reads only; every write goes through the functions below.
revoke all on public.tutor_waitlist from anon, authenticated;
grant select on public.tutor_waitlist to authenticated;

-- ---- 2. joining and leaving -----------------------------------------------------------------------------------------
create or replace function public.join_tutor_waitlist(
  p_student uuid,
  p_subject text,
  p_grade text default null,
  p_institution uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_open int;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_student is null or not public.can_book_for(p_student) then
    raise exception 'You can only ask for yourself or for a learner you look after' using errcode = '42501';
  end if;
  if v_subject = '' or length(v_subject) > 100 then
    raise exception 'Choose a subject' using errcode = '22023';
  end if;
  if v_grade is not null and length(v_grade) > 50 then
    raise exception 'That grade is too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.available_price_levels(v_subject, v_grade, p_institution)) then
    raise exception 'A tutor is already available for this search' using errcode = '55000';
  end if;

  -- An expired open entry would block a new one with the same details; clear the caller's own.
  delete from public.tutor_waitlist
   where requested_by = auth.uid() and notified_at is null and created_at <= now() - interval '60 days';

  select count(*) into v_open from public.tutor_waitlist where requested_by = auth.uid() and notified_at is null;
  if v_open >= 10 then
    raise exception 'You already have 10 open requests to be told when a tutor is available' using errcode = '54000';
  end if;

  begin
    insert into public.tutor_waitlist (student_id, requested_by, subject, grade_level, institution_id)
    values (p_student, auth.uid(), v_subject, v_grade, p_institution)
    returning id into v_id;
  exception when unique_violation then
    -- already waiting for exactly this: return the existing entry
    select id into v_id from public.tutor_waitlist
     where requested_by = auth.uid()
       and student_id = p_student
       and notified_at is null
       and lower(btrim(subject)) = lower(v_subject)
       and coalesce(lower(btrim(grade_level)), '') = coalesce(lower(v_grade), '')
       and coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_institution, '00000000-0000-0000-0000-000000000000'::uuid)
     limit 1;
  end;
  return v_id;
end;
$$;

create or replace function public.leave_tutor_waitlist(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from public.tutor_waitlist where id = p_id and requested_by = auth.uid();
end;
$$;

revoke all on function public.join_tutor_waitlist(uuid, text, text, uuid) from public, anon;
revoke all on function public.leave_tutor_waitlist(uuid) from public, anon;
grant execute on function public.join_tutor_waitlist(uuid, text, text, uuid) to authenticated;
grant execute on function public.leave_tutor_waitlist(uuid) to authenticated;

-- ---- 3. telling people ------------------------------------------------------------------------------------------------
create or replace function public.notify_tutor_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id, requested_by, subject, grade_level, institution_id
      from public.tutor_waitlist
     where notified_at is null and created_at > now() - interval '60 days'
     for update skip locked
  loop
    if exists (select 1 from public.available_price_levels(r.subject, r.grade_level, r.institution_id)) then
      insert into public.notifications (profile_id, type, title, body)
      values (
        r.requested_by,
        'tutor_available',
        'A tutor is now available',
        'You asked us to tell you when a tutor was available for ' || r.subject
          || case when r.grade_level is not null then ' (' || r.grade_level || ')' else '' end
          || '. You can send your request now.'
      );
      update public.tutor_waitlist set notified_at = now() where id = r.id;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.notify_tutor_waitlist() from public, anon, authenticated;

drop trigger if exists trg_waitlist_on_tutor_approved on public.tutor_profiles;
create trigger trg_waitlist_on_tutor_approved
  after update of is_verified on public.tutor_profiles
  for each row when (new.is_verified and not coalesce(old.is_verified, false))
  execute function public.notify_tutor_waitlist();

drop trigger if exists trg_waitlist_on_subject_verified on public.tutor_subject_competencies;
create trigger trg_waitlist_on_subject_verified
  after insert or update of verification_status on public.tutor_subject_competencies
  for each row when (new.verification_status = 'verified')
  execute function public.notify_tutor_waitlist();

-- ---- 4. clean-up ----------------------------------------------------------------------------------------------------------
create or replace function public.purge_old_tutor_waitlist()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.tutor_waitlist where coalesce(notified_at, created_at) < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_tutor_waitlist() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-old-tutor-waitlist', '23 3 * * *', 'select public.purge_old_tutor_waitlist();');
  end if;
end $$;
