-- The founding tutors list, part 2 (11 Nov 2026; Programmer A; Marketing's measurement document section 9.2 and the PM's queue):
--   R5  a dated step for every person, computed from the source tables through a view (only the wave number, "messaged" and "last contacted" are stored on the list,
--       plus three stamps on the tutor's profile that nothing else records: the day a tutor was approved, the day they were declined, the first time they saved hours)
--   R6  funnel by wave          R8  suggested release list          R9  trigger panel (three lights, the rate, the open stop rules)
--   R10 verification pipeline   R11 form-answer summaries           R4  abandons by the last field touched
-- Additive and inert: nothing changes for a user. The Teach gate switch is not touched. Safe to run before the new admin screens exist (they open cleanly without it).
-- It re-creates five functions from the first part (release, add a person, set status, mark messaged, the daily job) with the same names and the same answers, adding the
-- wave number and the "last contacted" stamp; the old calls keep working (the wave argument is optional).

-- 1. what is stored ------------------------------------------------------------------------------------------------------------------------------
alter table public.founding_tutors_list add column if not exists wave integer;
alter table public.founding_tutors_list add column if not exists last_contacted_at timestamptz;
alter table public.founding_tutors_list add column if not exists suggest_skip boolean not null default false;
alter table public.founding_tutors_list drop constraint if exists founding_list_wave_range;
alter table public.founding_tutors_list add constraint founding_list_wave_range check (wave is null or wave between 1 and 99);
create index if not exists founding_tutors_list_wave_idx on public.founding_tutors_list (wave) where wave is not null;

-- people already released before this change: the CEO's warm tutors (added by an admin) are wave 1, anyone released from the form is wave 2
update public.founding_tutors_list set wave = case when source = 'admin' then 1 else 2 end
 where wave is null and source <> 'backfill' and status in ('released', 'signed_up', 'verified');

alter table public.tutor_profiles add column if not exists verified_at timestamptz;
alter table public.tutor_profiles add column if not exists declined_at timestamptz;
alter table public.tutor_profiles add column if not exists hours_saved_at timestamptz;

insert into public.system_settings (setting_key, setting_value, description) values
  ('founding_wave_cap', '15'::jsonb, 'The most people one release suggests (the CEO can change it on the Founding waves page).')
on conflict (setting_key) do nothing;
insert into public.system_settings (setting_key, setting_value, description) values
  ('founding_release_rate_default', '0.36'::jsonb, 'The release-to-approved rate used until a wave of 5 or more people released at least 7 days ago has measured the real one.')
on conflict (setting_key) do nothing;
insert into public.system_settings (setting_key, setting_value, description) values
  ('founding_stop_rules_open', '[]'::jsonb, 'Stop rules the CEO or PM marked open by hand (the ones no number can show): a list of {rule, note, since}.')
on conflict (setting_key) do nothing;

-- the last form field a visitor touched (R4): a field NAME only, never what was typed
create table if not exists public.founding_form_fields (
  visitor_id uuid primary key,
  last_field text not null,
  first_src text,
  updated_at timestamptz not null default now(),
  constraint founding_form_field_values check (last_field in (
    'full_name', 'code_name', 'whatsapp', 'email', 'is_adult', 'subjects', 'availability', 'unavailable_weeks', 'practicum', 'police_clearance',
    'parent_reach', 'parent_reach_willing', 'prior_tutoring', 'heard_from', 'have', 'consent_contact', 'consent_marketing'))
);
create index if not exists founding_form_fields_updated_idx on public.founding_form_fields (updated_at desc);
alter table public.founding_form_fields enable row level security;
revoke all on public.founding_form_fields from public, anon, authenticated, service_role;

-- 2. the three stamps on a tutor's profile ---------------------------------------------------------------------------------------------------------
-- verified_at: the moment is_verified turns true. declined_at: the moment onboarding_status turns "rejected". hours_saved_at: the first time hours were saved.
-- A person (an API call) can never write them, whether by an update or by inserting their own profile row; only the database does.
create or replace function public.tutor_funnel_stamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.verified_at := null;
      new.declined_at := null;
      new.hours_saved_at := null;
      new.first_request_seen_at := null;
    end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    new.verified_at := old.verified_at;
    new.declined_at := old.declined_at;
    new.hours_saved_at := old.hours_saved_at;
  end if;
  if coalesce(new.is_verified, false) and not coalesce(old.is_verified, false) then
    new.verified_at := now();
  end if;
  if new.onboarding_status::text = 'rejected' and old.onboarding_status::text is distinct from 'rejected' then
    new.declined_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.tutor_funnel_stamps() from public, anon, authenticated, service_role;
drop trigger if exists tutor_funnel_stamps on public.tutor_profiles;
create trigger tutor_funnel_stamps before insert or update of is_verified, onboarding_status, verified_at, declined_at, hours_saved_at on public.tutor_profiles
  for each row execute function public.tutor_funnel_stamps();

create or replace function public.tutor_hours_saved_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.tutor_profiles set hours_saved_at = now() where id = new.tutor_id and hours_saved_at is null;
  exception when others then
    null;  -- saving hours must never be stopped by a counter
  end;
  return null;
end;
$$;
revoke all on function public.tutor_hours_saved_stamp() from public, anon, authenticated, service_role;
drop trigger if exists tutor_hours_saved_stamp on public.tutor_availability;
create trigger tutor_hours_saved_stamp after insert on public.tutor_availability
  for each row execute function public.tutor_hours_saved_stamp();

-- 3. the views (no API role can read them; the admin functions below read them as the owner) -----------------------------------------------------------
create or replace view public.founding_tutor_facts as
select tp.id as tutor_id,
       o.completed_at,
       coalesce(tp.is_verified, false) as is_verified,
       case when coalesce(tp.is_verified, false) then tp.verified_at end as verified_at,
       (not coalesce(tp.is_verified, false) and tp.onboarding_status::text = 'rejected') as is_declined,
       case when not coalesce(tp.is_verified, false) and tp.onboarding_status::text = 'rejected' then tp.declined_at end as declined_at,
       case
         when coalesce(tp.is_verified, false) or tp.onboarding_status::text <> 'rejected' then null
         when exists (select 1 from public.tutor_verification_documents d where d.tutor_id = tp.id and d.document_type::text = 'police_clearance' and d.status::text = 'rejected') then 'clearance'
         when o.completed_at is null then 'document_missing'
         else 'other'
       end as decline_reason
from public.tutor_profiles tp
left join public.tutor_onboarding o on o.tutor_id = tp.id;
revoke all on public.founding_tutor_facts from public, anon, authenticated, service_role;

create or replace view public.founding_person_steps as
select f.id, f.source, f.status, f.wave, f.src,
       (coalesce(f.src, '') like 'test%') as is_test,
       coalesce(f.full_name, pr.full_name) as full_name,
       f.code_name,
       f.created_at as joined_at,
       f.released_at, f.released_messaged_at, f.lapsed_at, f.last_contacted_at, f.suggest_skip,
       case when tp.id is not null then acc.id end as tutor_id,
       case when tp.id is not null then pr.created_at end as account_created_at,
       o.consented_at as agreed_at,
       cmp.first_subject_at,
       case when o.track is not null and o.consented_at is not null and cmp.first_subject_at is not null then greatest(o.consented_at, cmp.first_subject_at) end as signup_finished_at,
       docs.first_document_at,
       tf.completed_at as documents_complete_at,
       coalesce(tf.is_verified, false) as is_verified,
       tf.verified_at as approved_at,
       coalesce(tf.is_declined, false) as is_declined,
       tf.declined_at, tf.decline_reason,
       tp.hours_saved_at,
       exists (select 1 from public.tutor_availability a where a.tutor_id = acc.id) as has_hours,
       tp.first_request_seen_at,
       ss.first_accepted_at, ss.first_completed_at, ss.second_completed_at
from public.founding_tutors_list f
left join lateral (select coalesce(f.user_id, (select u.id from auth.users u where f.email_key is not null and lower(btrim(u.email)) = f.email_key limit 1)) as id) acc on true
left join public.profiles pr on pr.id = acc.id
left join public.tutor_profiles tp on tp.id = acc.id
left join public.tutor_onboarding o on o.tutor_id = acc.id
left join public.founding_tutor_facts tf on tf.tutor_id = acc.id
left join lateral (select min(c.created_at) as first_subject_at from public.tutor_subject_competencies c where c.tutor_id = acc.id) cmp on true
left join lateral (select min(d.uploaded_at) as first_document_at from public.tutor_verification_documents d where d.tutor_id = acc.id) docs on true
left join lateral (
  select min(s.created_at) as first_accepted_at,
         min(s.completed_at) filter (where s.status::text = 'completed') as first_completed_at,
         (array_agg(s.completed_at order by s.completed_at) filter (where s.status::text = 'completed'))[2] as second_completed_at
  from public.sessions s where s.tutor_id = acc.id) ss on true;
revoke all on public.founding_person_steps from public, anon, authenticated, service_role;

-- 4. R5: a dated step for every person -------------------------------------------------------------------------------------------------------------
create or replace function public.admin_founding_steps()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the steps' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(t.j order by t.joined_at desc)
    from (
      select s.joined_at,
        jsonb_build_object(
          'id', s.id, 'source', s.source, 'status', s.status, 'wave', s.wave, 'src', s.src, 'is_test', s.is_test,
          'full_name', s.full_name, 'code_name', s.code_name,
          'joined_at', s.joined_at, 'released_at', s.released_at, 'released_messaged_at', s.released_messaged_at, 'lapsed_at', s.lapsed_at, 'last_contacted_at', s.last_contacted_at,
          'account_at', s.account_created_at, 'agreed_at', s.agreed_at, 'signup_finished_at', s.signup_finished_at,
          'first_document_at', s.first_document_at, 'documents_complete_at', s.documents_complete_at,
          'is_verified', s.is_verified, 'approved_at', s.approved_at, 'is_declined', s.is_declined, 'declined_at', s.declined_at, 'decline_reason', s.decline_reason,
          'hours_saved_at', s.hours_saved_at, 'has_hours', s.has_hours, 'first_request_seen_at', s.first_request_seen_at,
          'first_accepted_at', s.first_accepted_at, 'first_completed_at', s.first_completed_at, 'second_completed_at', s.second_completed_at,
          'stage', case
            when s.second_completed_at is not null then 'second_lesson'
            when s.first_completed_at is not null then 'first_lesson_done'
            when s.first_accepted_at is not null then 'first_lesson_booked'
            when s.first_request_seen_at is not null then 'first_request'
            when s.is_verified then 'approved'
            when s.is_declined then 'declined'
            when s.documents_complete_at is not null then 'documents_complete'
            when s.first_document_at is not null then 'documents_started'
            when s.signup_finished_at is not null then 'signup_finished'
            when s.account_created_at is not null then 'account'
            when s.status = 'joined' and s.lapsed_at is not null then 'lapsed'
            when s.released_messaged_at is not null then 'messaged'
            when s.status in ('released', 'signed_up', 'verified') then 'released'
            else 'joined' end
        ) as j
      from public.founding_person_steps s
      where s.source <> 'backfill'
      order by s.joined_at desc
      limit 3000
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_steps() from public, anon;
grant execute on function public.admin_founding_steps() to authenticated;

-- 5. the measured release-to-approved rate (internal) ---------------------------------------------------------------------------------------------
-- Waves 2 and later only (wave 1 is the CEO's warm tutors, not the faculty), a wave counts once it has 5 or more people released and the first was released at least 7 days ago.
create or replace function public.founding_release_rate()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_default numeric;
  v_rel bigint;
  v_app bigint;
  v_waves int[];
begin
  select case when jsonb_typeof(s.setting_value) = 'number' then (s.setting_value #>> '{}')::numeric end into v_default
    from public.system_settings s where s.setting_key = 'founding_release_rate_default';
  v_default := least(greatest(coalesce(v_default, 0.36), 0.01), 1);
  select coalesce(sum(q.n), 0), coalesce(sum(q.approved), 0), coalesce(array_agg(q.wave order by q.wave), '{}'::int[])
    into v_rel, v_app, v_waves
  from (
    select s.wave, count(*) as n, count(*) filter (where s.is_verified) as approved
    from public.founding_person_steps s
    where s.source <> 'backfill' and not s.is_test and s.wave >= 2
    group by s.wave
    having count(*) >= 5 and min(s.released_at) <= now() - interval '7 days'
  ) q;
  if v_rel > 0 then
    return jsonb_build_object('rate', round(v_app::numeric / v_rel, 3), 'measured', true, 'waves', to_jsonb(v_waves), 'released', v_rel, 'approved', v_app);
  end if;
  return jsonb_build_object('rate', v_default, 'measured', false, 'waves', '[]'::jsonb, 'released', 0, 'approved', 0);
end;
$$;
revoke all on function public.founding_release_rate() from public, anon, authenticated, service_role;

-- 6. R6: funnel by wave ---------------------------------------------------------------------------------------------------------------------------------
-- One block per wave and a last one for all waves together (wave 0). Each step: how many reached it, the percentage of those released, the average and median days from the step
-- before it, and the oldest person waiting at it (reached the step before, not this one, not lapsed, not declined).
create or replace function public.admin_founding_waves()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the waves' using errcode = '42501';
  end if;
  with m as (
    select s.*, w.wk
    from public.founding_person_steps s
    cross join lateral (values (s.wave), (0)) as w(wk)
    where s.source <> 'backfill' and not s.is_test and s.wave is not null
  ),
  base as (
    select m.wk, count(*) as released_n,
           count(*) filter (where m.released_messaged_at is not null) as messaged_n,
           count(*) filter (where m.lapsed_at is not null and m.status = 'joined') as lapsed_n,
           count(*) filter (where m.is_declined) as declined_n
    from m group by m.wk
  ),
  steps as (
    select m.wk, d.ord, d.key, d.label, d.reached, d.dt, d.prev_reached, d.prev_dt, m.released_at, m.lapsed_at, m.status, m.is_declined
    from m
    cross join lateral (values
      (1, 'account', 'Account made', m.account_created_at is not null, m.account_created_at, true, m.released_at),
      (2, 'signup_finished', 'Sign-up finished', m.signup_finished_at is not null, m.signup_finished_at, m.account_created_at is not null, m.account_created_at),
      (3, 'documents_complete', 'Documents complete', m.documents_complete_at is not null, m.documents_complete_at, m.signup_finished_at is not null, m.signup_finished_at),
      (4, 'approved', 'Approved', m.is_verified, m.approved_at, m.documents_complete_at is not null, m.documents_complete_at),
      (5, 'first_request', 'First request seen', m.first_request_seen_at is not null, m.first_request_seen_at, m.is_verified, m.approved_at),
      (6, 'first_accepted', 'First lesson accepted', m.first_accepted_at is not null, m.first_accepted_at, m.first_request_seen_at is not null, m.first_request_seen_at),
      (7, 'first_completed', 'First lesson completed', m.first_completed_at is not null, m.first_completed_at, m.first_accepted_at is not null, m.first_accepted_at),
      (8, 'second_completed', 'Second lesson completed', m.second_completed_at is not null, m.second_completed_at, m.first_completed_at is not null, m.first_completed_at)
    ) as d(ord, key, label, reached, dt, prev_reached, prev_dt)
  ),
  agg as (
    select st.wk, st.ord, st.key, st.label,
           count(*) filter (where st.reached) as n,
           round((avg(extract(epoch from st.dt - st.prev_dt) / 86400.0) filter (where st.reached and st.dt is not null and st.prev_dt is not null and st.dt >= st.prev_dt))::numeric, 1) as avg_days,
           round((percentile_cont(0.5) within group (order by extract(epoch from st.dt - st.prev_dt) / 86400.0) filter (where st.reached and st.dt is not null and st.prev_dt is not null and st.dt >= st.prev_dt))::numeric, 1) as median_days,
           round((max(extract(epoch from now() - coalesce(st.prev_dt, st.released_at)) / 86400.0) filter (where st.prev_reached and not st.reached and not st.is_declined and not (st.lapsed_at is not null and st.status = 'joined')))::numeric, 1) as oldest_days
    from steps st
    group by st.wk, st.ord, st.key, st.label
  )
  select jsonb_agg(
           jsonb_build_object(
             'wave', b.wk, 'released', b.released_n, 'messaged', b.messaged_n, 'lapsed', b.lapsed_n, 'declined', b.declined_n,
             'steps', (select jsonb_agg(jsonb_build_object('key', a.key, 'label', a.label, 'n', a.n,
                                                           'pct', case when b.released_n > 0 then round(100.0 * a.n / b.released_n, 0) else 0 end,
                                                           'avg_days', a.avg_days, 'median_days', a.median_days, 'oldest_days', a.oldest_days) order by a.ord)
                       from agg a where a.wk = b.wk))
           order by (b.wk = 0), b.wk)
    into v
  from base b;
  return coalesce(v, '[]'::jsonb);
end;
$$;
revoke all on function public.admin_founding_waves() from public, anon;
grant execute on function public.admin_founding_waves() to authenticated;

-- 7. R10: the verification pipeline ----------------------------------------------------------------------------------------------------------------------
-- All tutors (not only people from the list): a "complete set" is the moment tutor_onboarding.completed_at was stamped.
create or replace function public.admin_founding_pipeline()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the verification pipeline' using errcode = '42501';
  end if;
  with facts as (select * from public.founding_tutor_facts),
  waiting as (
    select f.tutor_id, extract(epoch from now() - f.completed_at) / 86400.0 as days
    from facts f where f.completed_at is not null and not f.is_verified and not f.is_declined
  ),
  decided as (
    select f.*, coalesce(f.verified_at, f.declined_at) as decided_at
    from facts f where f.completed_at is not null and (f.is_verified or f.is_declined)
  ),
  weeks as (
    select (date_trunc('week', (now() at time zone 'Africa/Johannesburg'))::date - 7 * g) as wk from generate_series(0, 11) g
  )
  select jsonb_build_object(
    'waiting', (select count(*) from waiting),
    'oldest_days', (select round(max(days)::numeric, 1) from waiting),
    'over_5_days', (select count(*) from waiting where days > 5),
    'over_7_days', (select count(*) from waiting where days > 7),
    'avg_days_to_approval', (select round(avg(extract(epoch from d.verified_at - d.completed_at) / 86400.0)::numeric, 1) from decided d where d.is_verified and d.verified_at is not null and d.verified_at >= d.completed_at),
    'longest_decided_days', (select round(max(extract(epoch from d.decided_at - d.completed_at) / 86400.0)::numeric, 1) from decided d where d.decided_at is not null and d.decided_at >= d.completed_at),
    'declines_by_reason', coalesce((select jsonb_object_agg(x.r, x.n) from (select f.decline_reason as r, count(*) as n from facts f where f.is_declined group by f.decline_reason) x), '{}'::jsonb),
    'by_week', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', to_char(w.wk, 'YYYY-MM-DD'),
        'completed', (select count(*) from facts f where f.completed_at is not null and (f.completed_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.completed_at at time zone 'Africa/Johannesburg')::date < w.wk + 7),
        'approved', (select count(*) from facts f where f.is_verified and f.verified_at is not null and (f.verified_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.verified_at at time zone 'Africa/Johannesburg')::date < w.wk + 7),
        'declined', (select count(*) from facts f where f.is_declined and f.declined_at is not null and (f.declined_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.declined_at at time zone 'Africa/Johannesburg')::date < w.wk + 7),
        'avg_days', (select round(avg(extract(epoch from f.verified_at - f.completed_at) / 86400.0)::numeric, 1) from facts f
                      where f.is_verified and f.verified_at is not null and f.completed_at is not null and f.verified_at >= f.completed_at
                        and (f.verified_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.verified_at at time zone 'Africa/Johannesburg')::date < w.wk + 7),
        'longest_days', (select round(max(extract(epoch from f.verified_at - f.completed_at) / 86400.0)::numeric, 1) from facts f
                      where f.is_verified and f.verified_at is not null and f.completed_at is not null and f.verified_at >= f.completed_at
                        and (f.verified_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.verified_at at time zone 'Africa/Johannesburg')::date < w.wk + 7),
        'declines_by_reason', coalesce((select jsonb_object_agg(y.r, y.n) from (select f.decline_reason as r, count(*) as n from facts f
                      where f.is_declined and f.declined_at is not null and (f.declined_at at time zone 'Africa/Johannesburg')::date >= w.wk and (f.declined_at at time zone 'Africa/Johannesburg')::date < w.wk + 7
                      group by f.decline_reason) y), '{}'::jsonb)
      ) order by w.wk desc)
      from weeks w), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_founding_pipeline() from public, anon;
grant execute on function public.admin_founding_pipeline() to authenticated;

-- 8. R9: the trigger panel ------------------------------------------------------------------------------------------------------------------------------
-- Marketing's five release conditions (section 5.2): B1 demand, B2 the current wave is getting work (60 percent), B3 the queue is clear, B4 the rate is known, B5 no stop rule open.
-- "Met" is good. B4 is shown but does not block (the default rate is used until a wave measures it). Stop rules 4, 5 and 6 are worked out; the others are marked by hand.
create or replace function public.admin_founding_triggers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_cov jsonb;
  v_demand jsonb;
  v_demand_n int;
  v_ap int;
  v_work int;
  v_b2 text;
  v_q int;
  v_q_oldest numeric;
  v_noupload int;
  v_rate jsonb;
  v_over7 int;
  v_oldest numeric;
  v_money numeric := null;
  v_gap_subjects text;
  v_manual jsonb;
  v_rules jsonb := '[]'::jsonb;
  v_open int := 0;
  v_pipe jsonb;
  r int;
  v_note text;
  v_since text;
  v_is_open boolean;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the trigger panel' using errcode = '42501';
  end if;
  select max(s.wave) into v_cur from public.founding_person_steps s where s.source <> 'backfill' and not s.is_test and s.wave is not null;

  -- B1: demand. A subject and grade band with requests nobody served (pending 24 hours or more), or with requests and fewer than 3 ready tutors.
  v_cov := public.admin_founding_coverage();
  select count(*) into v_demand_n from jsonb_array_elements(v_cov) e where (e.value ->> 'unserved_requests')::int > 0 or (e.value ->> 'demand_no_supply')::boolean;
  select coalesce(jsonb_agg(x.value), '[]'::jsonb) into v_demand
  from (select e.value from jsonb_array_elements(v_cov) e
        where (e.value ->> 'unserved_requests')::int > 0 or (e.value ->> 'demand_no_supply')::boolean
        order by (e.value ->> 'unserved_requests')::int desc, (e.value ->> 'requests')::int desc limit 8) x;

  -- B2: the current wave is getting work.
  select count(*) filter (where s.is_verified), count(*) filter (where s.is_verified and (s.first_request_seen_at is not null or s.first_accepted_at is not null))
    into v_ap, v_work
  from public.founding_person_steps s where s.wave = v_cur and s.source <> 'backfill' and not s.is_test;
  v_b2 := case when v_cur is null or coalesce(v_ap, 0) = 0 then 'unknown' when v_work::numeric / v_ap >= 0.6 then 'met' else 'not_met' end;

  -- B3: the queue is clear (every person of the current wave with a COMPLETE document set is approved or declined).
  select count(*), round(max(extract(epoch from now() - s.documents_complete_at) / 86400.0)::numeric, 1)
    into v_q, v_q_oldest
  from public.founding_person_steps s
  where s.wave = v_cur and s.source <> 'backfill' and not s.is_test and s.documents_complete_at is not null and not s.is_verified and not s.is_declined
    and not (s.status = 'joined' and s.lapsed_at is not null);
  select count(*) into v_noupload
  from public.founding_person_steps s
  where s.wave = v_cur and s.source <> 'backfill' and not s.is_test and s.first_document_at is null and not (s.status = 'joined' and s.lapsed_at is not null);

  v_rate := public.founding_release_rate();

  -- the stop rules
  v_pipe := public.admin_founding_pipeline();
  v_over7 := coalesce((v_pipe ->> 'over_7_days')::int, 0);
  v_oldest := (v_pipe ->> 'oldest_days')::numeric;
  begin
    select coalesce(sum(u.amount_off), 0) into v_money from public.promo_code_uses u where u.returned_at is null and u.created_at >= now() - interval '28 days';
  exception when others then
    v_money := null;
  end;
  begin
    select string_agg(x.subject_name || ' (' || x.n || ')', ', ' order by x.n desc) into v_gap_subjects
    from (select e.subject_name, count(*) as n
          from public.session_requests r2 join public.student_subject_enrollments e on e.id = r2.enrollment_id
          where r2.status = 'expired' and r2.tutor_id is null and r2.created_at >= now() - interval '14 days'
          group by e.subject_name having count(*) >= 3) x;
  exception when others then
    v_gap_subjects := null;
  end;
  select coalesce(case when jsonb_typeof(s.setting_value) = 'array' then s.setting_value end, '[]'::jsonb) into v_manual
    from public.system_settings s where s.setting_key = 'founding_stop_rules_open';
  v_manual := coalesce(v_manual, '[]'::jsonb);

  for r in 1..8 loop
    v_note := null;
    v_since := null;
    if r in (1, 2, 3, 7, 8) then
      select m.value ->> 'note', m.value ->> 'since' into v_note, v_since from jsonb_array_elements(v_manual) m where (m.value ->> 'rule')::int = r limit 1;
      v_is_open := found;
    elsif r = 4 then
      v_is_open := v_over7 > 0;
      v_note := case when v_is_open then v_over7 || ' complete document set(s) waiting more than 7 days; the oldest has waited ' || coalesce(v_oldest::text, '?') || ' days' end;
    elsif r = 5 then
      v_is_open := coalesce(v_money, 0) > 2500;
      v_note := case when v_money is null then 'could not be worked out' else 'R' || v_money::int || ' given away in the last 28 days (the line is R2,500)' end;
    else
      v_is_open := v_gap_subjects is not null;
      v_note := v_gap_subjects;
    end if;
    if v_is_open then v_open := v_open + 1; end if;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object(
      'rule', r, 'kind', case when r in (4, 5, 6) then 'auto' else 'manual' end, 'open', v_is_open, 'note', v_note, 'since', v_since,
      'label', case r
        when 1 then 'A child-safety report, or a complaint about the message or the page'
        when 2 then 'An identity or bank document arrived through WhatsApp, or a list entry or counter holds data it should not'
        when 3 then 'The page, the form or the counters are broken'
        when 4 then 'Verification overdue: a complete document set has waited more than 7 days'
        when 5 then 'Money: more than R2,500 given away in 28 days'
        when 6 then 'Demand gap: 3 or more requests expired unserved in one subject in 14 days'
        when 7 then 'Misread pay: 3 or more replies in a week say the pay line was misleading'
        else 'The channel has failed: under 9 joins at day 14, after one nudge' end));
  end loop;

  return jsonb_build_object(
    'current_wave', v_cur,
    'b1', jsonb_build_object('state', case when v_demand_n > 0 then 'met' else 'not_met' end, 'demand_rows', v_demand_n, 'rows', v_demand),
    'b2', jsonb_build_object('state', v_b2, 'approved', coalesce(v_ap, 0), 'working', coalesce(v_work, 0), 'line_pct', 60,
                             'share_pct', case when coalesce(v_ap, 0) > 0 then round(100.0 * v_work / v_ap, 0) end),
    'b3', jsonb_build_object('state', case when v_cur is null then 'unknown' when v_q = 0 then 'met' else 'not_met' end, 'waiting', coalesce(v_q, 0), 'oldest_days', v_q_oldest, 'not_uploaded', coalesce(v_noupload, 0)),
    'b4', jsonb_build_object('state', case when (v_rate ->> 'measured')::boolean then 'met' else 'default' end, 'rate', v_rate -> 'rate', 'measured', v_rate -> 'measured', 'waves', v_rate -> 'waves'),
    'b5', jsonb_build_object('state', case when v_open = 0 then 'met' else 'not_met' end, 'open', v_open),
    'all_clear', (v_demand_n > 0 and v_b2 = 'met' and v_cur is not null and v_q = 0 and v_open = 0),
    'stop_rules', v_rules);
end;
$$;
revoke all on function public.admin_founding_triggers() from public, anon;
grant execute on function public.admin_founding_triggers() to authenticated;

create or replace function public.admin_set_founding_stop_rule(p_rule integer, p_open boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can mark a stop rule' using errcode = '42501';
  end if;
  if p_rule is null or p_rule not in (1, 2, 3, 7, 8) then
    raise exception 'Rules 4, 5 and 6 are worked out from the numbers; only rules 1, 2, 3, 7 and 8 are marked by hand' using errcode = '22023';
  end if;
  if p_open is null then raise exception 'Choose open or closed' using errcode = '22023'; end if;
  select coalesce(case when jsonb_typeof(s.setting_value) = 'array' then s.setting_value end, '[]'::jsonb) into v_old from public.system_settings s where s.setting_key = 'founding_stop_rules_open';
  v_old := coalesce(v_old, '[]'::jsonb);
  select coalesce(jsonb_agg(m.value), '[]'::jsonb) into v_new from jsonb_array_elements(v_old) m where (m.value ->> 'rule')::int <> p_rule;
  if p_open then
    v_new := v_new || jsonb_build_array(jsonb_build_object('rule', p_rule, 'note', left(nullif(btrim(coalesce(p_note, '')), ''), 200), 'since', now()));
  end if;
  insert into public.system_settings (setting_key, setting_value, description, last_updated_by, updated_at)
  values ('founding_stop_rules_open', v_new, 'Stop rules marked open by hand.', auth.uid(), now())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, last_updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_set_founding_stop_rule(integer, boolean, text) from public, anon;
grant execute on function public.admin_set_founding_stop_rule(integer, boolean, text) to authenticated;

-- 9. R8: the suggested release list ---------------------------------------------------------------------------------------------------------------------
-- The order rule: people who cover a subject-and-band that has demand and fewer than 3 ready tutors first, then the order people joined. Size = the gap divided by the measured
-- release-to-approved rate, at most the wave cap. The gap is the total shortfall (3 minus the ready tutors) over the demand rows that someone waiting could cover.
create or replace function public.admin_founding_suggestion()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_rate jsonb;
  v_r numeric;
  v_cov jsonb;
  v_gap int;
  v_n int;
  v_max int;
  v_next int;
  v_demand jsonb;
  v_people jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the suggested release list' using errcode = '42501';
  end if;
  select case when jsonb_typeof(s.setting_value) = 'number' then (s.setting_value #>> '{}')::int end into v_cap from public.system_settings s where s.setting_key = 'founding_wave_cap';
  v_cap := least(greatest(coalesce(v_cap, 15), 1), 200);
  v_rate := public.founding_release_rate();
  v_r := greatest((v_rate ->> 'rate')::numeric, 0.05);
  v_cov := public.admin_founding_coverage();
  select max(l.wave) into v_max from public.founding_tutors_list l where l.source <> 'backfill' and l.wave is not null;
  v_next := greatest(2, coalesce(v_max, 1) + 1);

  with dem as (
    select e.value ->> 'subject' as subj, e.value ->> 'phase' as phase, greatest(0, 3 - (e.value ->> 'ready_tutors')::int) as shortfall,
           (e.value ->> 'requests')::int as requests, (e.value ->> 'unserved_requests')::int as unserved, (e.value ->> 'ready_tutors')::int as ready
    from jsonb_array_elements(v_cov) e
    where (e.value ->> 'unserved_requests')::int > 0 or (e.value ->> 'demand_no_supply')::boolean
  ),
  cover as (
    select distinct p.id, d.subj, d.phase
    from public.founding_person_steps p
    join public.founding_tutors_list l on l.id = p.id
    cross join lateral jsonb_array_elements(l.subjects) el
    cross join lateral unnest(public.founding_phases(el ->> 'min_grade', el ->> 'max_grade')) ph(phase)
    join dem d on d.subj = el ->> 'subject' and d.phase = ph.phase
    where p.source = 'form' and not p.is_test and p.status = 'joined' and not p.suggest_skip
  ),
  gap as (
    select coalesce(sum(d.shortfall), 0)::int as g from dem d where exists (select 1 from cover c where c.subj = d.subj and c.phase = d.phase)
  ),
  sz as (
    select gap.g, case when gap.g = 0 then 0 else least(v_cap, greatest(1, ceil(gap.g / v_r)::int)) end as n from gap
  ),
  cv as (
    select c.id, count(*) as n, jsonb_agg(jsonb_build_object('subject', c.subj, 'phase', c.phase)) as covers from cover c group by c.id
  ),
  ranked as (
    select p.id, p.full_name, p.code_name, p.joined_at, p.suggest_skip, (p.lapsed_at is not null) as lapsed,
           coalesce(cv.n, 0) as covers_n, coalesce(cv.covers, '[]'::jsonb) as covers,
           row_number() over (order by p.suggest_skip, (coalesce(cv.n, 0) > 0) desc, p.joined_at) as rn
    from public.founding_person_steps p
    left join cv on cv.id = p.id
    where p.source = 'form' and not p.is_test and p.status = 'joined'
  )
  select (select sz.g from sz), (select sz.n from sz),
         (select coalesce(jsonb_agg(jsonb_build_object('subject', d.subj, 'phase', d.phase, 'shortfall', d.shortfall, 'requests', d.requests, 'unserved', d.unserved, 'ready_tutors', d.ready,
                                                       'people_waiting', (select count(distinct c.id) from cover c where c.subj = d.subj and c.phase = d.phase))
                                order by d.unserved desc, d.requests desc), '[]'::jsonb) from dem d),
         (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'full_name', q.full_name, 'code_name', q.code_name, 'joined_at', q.joined_at, 'skipped', q.suggest_skip, 'lapsed', q.lapsed,
                                                       'covers_n', q.covers_n, 'covers', q.covers, 'suggested', (not q.suggest_skip and q.rn <= (select sz.n from sz)))
                                order by q.suggest_skip, q.rn), '[]'::jsonb)
          from (select * from ranked order by suggest_skip, rn limit 60) q)
    into v_gap, v_n, v_demand, v_people;
  return jsonb_build_object('cap', v_cap, 'rate', v_rate -> 'rate', 'rate_measured', v_rate -> 'measured', 'rate_waves', v_rate -> 'waves',
                            'gap', v_gap, 'suggested_n', v_n, 'next_wave', v_next, 'demand', v_demand, 'people', v_people);
end;
$$;
revoke all on function public.admin_founding_suggestion() from public, anon;
grant execute on function public.admin_founding_suggestion() to authenticated;

create or replace function public.admin_set_founding_suggest_skip(p_id uuid, p_skip boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can change the suggestion' using errcode = '42501';
  end if;
  if p_skip is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  update public.founding_tutors_list set suggest_skip = p_skip where id = p_id and source <> 'backfill';
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_set_founding_suggest_skip(uuid, boolean) from public, anon;
grant execute on function public.admin_set_founding_suggest_skip(uuid, boolean) to authenticated;

create or replace function public.admin_set_founding_wave_cap(p_cap integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can change the wave cap' using errcode = '42501';
  end if;
  if p_cap is null or p_cap < 1 or p_cap > 200 then
    raise exception 'The wave cap is a number from 1 to 200' using errcode = '22023';
  end if;
  insert into public.system_settings (setting_key, setting_value, description, last_updated_by, updated_at)
  values ('founding_wave_cap', to_jsonb(p_cap), 'The most people one release suggests.', auth.uid(), now())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, last_updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true, 'cap', p_cap);
end;
$$;
revoke all on function public.admin_set_founding_wave_cap(integer) from public, anon;
grant execute on function public.admin_set_founding_wave_cap(integer) to authenticated;

-- 10. R11: form-answer summaries ----------------------------------------------------------------------------------------------------------------------
-- Counts only (people who joined from the form, test tags left out), for a range of South African days (null = all time) and optionally one tag.
create or replace function public.admin_founding_answers(p_from date default null, p_to date default null, p_src text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_src text := lower(nullif(btrim(coalesce(p_src, '')), ''));
  v jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the answer summaries' using errcode = '42501';
  end if;
  with f as (
    select l.* from public.founding_tutors_list l
    where l.source = 'form' and coalesce(l.src, '') not like 'test%'
      and (p_from is null or (l.created_at at time zone 'Africa/Johannesburg')::date >= p_from)
      and (p_to is null or (l.created_at at time zone 'Africa/Johannesburg')::date <= p_to)
      and (v_src is null or l.src = v_src)
  ),
  bands as (
    select distinct f.id, ph.phase from f cross join lateral jsonb_array_elements(f.subjects) el cross join lateral unnest(public.founding_phases(el ->> 'min_grade', el ->> 'max_grade')) ph(phase)
  ),
  subj as (
    select el ->> 'subject' as subject, count(distinct f.id) as n from f cross join lateral jsonb_array_elements(f.subjects) el group by 1 order by 2 desc, 1 limit 15
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'police', coalesce((select jsonb_object_agg(x.k, x.n) from (select coalesce(f.police_clearance, '(none)') as k, count(*) as n from f group by 1) x), '{}'::jsonb),
    'practicum', coalesce((select jsonb_object_agg(x.k, x.n) from (select coalesce(f.practicum, '(none)') as k, count(*) as n from f group by 1) x), '{}'::jsonb),
    'parent_reach', coalesce((select jsonb_object_agg(x.k, x.n) from (select coalesce(f.parent_reach, '(none)') as k, count(*) as n from f group by 1) x), '{}'::jsonb),
    'willing', jsonb_build_object('yes', (select count(*) from f where f.parent_reach_willing is true), 'no', (select count(*) from f where f.parent_reach_willing is false)),
    'availability', jsonb_build_object(
      'evenings', (select count(*) from f where 'evenings' = any (f.availability)),
      'weekends', (select count(*) from f where 'weekends' = any (f.availability)),
      'holidays', (select count(*) from f where 'holidays' = any (f.availability))),
    'bands', coalesce((select jsonb_object_agg(x.phase, x.n) from (select b.phase, count(*) as n from bands b group by 1) x), '{}'::jsonb),
    'top_subjects', coalesce((select jsonb_agg(jsonb_build_object('subject', s.subject, 'n', s.n) order by s.n desc, s.subject) from subj s), '[]'::jsonb),
    'heard', coalesce((select jsonb_object_agg(x.k, jsonb_build_object('n', x.n, 'with_registered_tag', x.tagged)) from
                       (select coalesce(f.heard_from, '(not said)') as k, count(*) as n, count(*) filter (where f.src is not null and public.founding_tag_registered(f.src)) as tagged from f group by 1) x), '{}'::jsonb),
    'consent_news', jsonb_build_object('yes', (select count(*) from f where f.consent_marketing_at is not null), 'no', (select count(*) from f where f.consent_marketing_at is null)),
    'have', jsonb_build_object('device', (select count(*) from f where f.has_device), 'connection', (select count(*) from f where f.has_connection), 'bank', (select count(*) from f where f.has_bank)),
    'weeks_unavailable_given', (select count(*) from f where f.unavailable_weeks is not null),
    'tutored_before_given', (select count(*) from f where f.prior_tutoring is not null),
    'by_week', coalesce((select jsonb_agg(jsonb_build_object('week_start', to_char(x.wk, 'YYYY-MM-DD'), 'joins', x.n) order by x.wk desc)
                         from (select date_trunc('week', f.created_at at time zone 'Africa/Johannesburg')::date as wk, count(*) as n from f group by 1 order by 1 desc limit 12) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_founding_answers(date, date, text) from public, anon;
grant execute on function public.admin_founding_answers(date, date, text) to authenticated;

-- 11. R4: abandons by the last field touched --------------------------------------------------------------------------------------------------------
create or replace function public.log_founding_field(p_visitor text, p_field text, p_first text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vis uuid;
  v_first text;
begin
  if p_field is null or p_field not in ('full_name', 'code_name', 'whatsapp', 'email', 'is_adult', 'subjects', 'availability', 'unavailable_weeks', 'practicum', 'police_clearance',
                                        'parent_reach', 'parent_reach_willing', 'prior_tutoring', 'heard_from', 'have', 'consent_contact', 'consent_marketing') then
    return;
  end if;
  if p_visitor is null or p_visitor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
  v_vis := p_visitor::uuid;
  v_first := lower(btrim(coalesce(p_first, '')));
  if v_first !~ '^[a-z0-9_-]{1,32}$' then v_first := null; end if;
  if (select count(*) from public.founding_form_fields where updated_at > now() - interval '1 hour') > 20000 then return; end if;
  insert into public.founding_form_fields (visitor_id, last_field, first_src) values (v_vis, p_field, v_first)
  on conflict (visitor_id) do update set last_field = excluded.last_field, updated_at = now();
end;
$$;
revoke all on function public.log_founding_field(text, text, text) from public;
grant execute on function public.log_founding_field(text, text, text) to anon, authenticated;

create or replace function public.admin_founding_abandons(p_from date default null, p_to date default null, p_src text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_src text := lower(nullif(btrim(coalesce(p_src, '')), ''));
  v jsonb;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can see the abandons' using errcode = '42501';
  end if;
  with starts as (
    select distinct on (e.visitor_id) e.visitor_id, coalesce(nullif(e.first_src, ''), nullif(e.src, ''), '(none)') as tag, e.created_at
    from public.founding_page_events e
    where e.event = 'form_start' and coalesce(e.src, '') not like 'test%' and coalesce(e.first_src, '') not like 'test%'
      and (p_from is null or (e.created_at at time zone 'Africa/Johannesburg')::date >= p_from)
      and (p_to is null or (e.created_at at time zone 'Africa/Johannesburg')::date <= p_to)
    order by e.visitor_id, e.created_at
  ),
  s as (
    select st.visitor_id, st.tag, ff.last_field,
           exists (select 1 from public.founding_page_events j where j.visitor_id = st.visitor_id and j.event = 'join') as joined
    from starts st left join public.founding_form_fields ff on ff.visitor_id = st.visitor_id
    where v_src is null or st.tag = v_src
  )
  select jsonb_build_object(
    'started', (select count(*) from s),
    'joined', (select count(*) from s where joined),
    'abandoned', (select count(*) from s where not joined),
    'by_field', coalesce((select jsonb_agg(jsonb_build_object('field', x.f, 'n', x.n) order by x.n desc, x.f)
                          from (select coalesce(s.last_field, '(not recorded)') as f, count(*) as n from s where not s.joined group by 1) x), '[]'::jsonb),
    'by_src', coalesce((select jsonb_agg(jsonb_build_object('src', x.tag, 'field', x.f, 'n', x.n) order by x.tag, x.n desc, x.f)
                        from (select s.tag, coalesce(s.last_field, '(not recorded)') as f, count(*) as n from s where not s.joined group by 1, 2) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_founding_abandons(date, date, text) from public, anon;
grant execute on function public.admin_founding_abandons(date, date, text) to authenticated;

-- 12. the wave number: release, add a person, correct, and "last contacted" ---------------------------------------------------------------------
-- A release without a wave number joins the latest wave if that wave began less than 3 days ago (one round of releasing), otherwise it starts the next wave (the first is 2:
-- wave 1 is the CEO's warm tutors, who are added by an admin).
drop function if exists public.admin_release_founding(uuid[]);
create or replace function public.admin_release_founding(p_ids uuid[], p_wave integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_wave integer := p_wave;
  v_max integer;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can release places' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Choose between 1 and 500 people to release' using errcode = '22023';
  end if;
  if v_wave is not null and (v_wave < 1 or v_wave > 99) then
    raise exception 'A wave number is from 1 to 99' using errcode = '22023';
  end if;
  if v_wave is null then
    select max(l.wave) into v_max from public.founding_tutors_list l where l.source <> 'backfill' and l.wave is not null;
    if v_max is not null and v_max >= 2 and exists (select 1 from public.founding_tutors_list l where l.source <> 'backfill' and l.wave = v_max and l.released_at > now() - interval '3 days') then
      v_wave := v_max;
    else
      v_wave := greatest(2, coalesce(v_max, 1) + 1);
    end if;
  end if;
  update public.founding_tutors_list
     set status = 'released', released_at = now(), delete_after = now() + interval '30 days', lapsed_at = null, released_messaged_at = null, wave = v_wave
   where id = any (p_ids) and status = 'joined';
  get diagnostics v_n = row_count;
  return jsonb_build_object('released', v_n, 'skipped', array_length(p_ids, 1) - v_n, 'wave', v_wave);
end;
$$;
revoke all on function public.admin_release_founding(uuid[], integer) from public, anon;
grant execute on function public.admin_release_founding(uuid[], integer) to authenticated;

create or replace function public.admin_set_founding_wave(p_ids uuid[], p_wave integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can change a wave number' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then
    raise exception 'Choose between 1 and 500 people' using errcode = '22023';
  end if;
  if p_wave is null or p_wave < 1 or p_wave > 99 then
    raise exception 'A wave number is from 1 to 99' using errcode = '22023';
  end if;
  update public.founding_tutors_list set wave = p_wave
   where id = any (p_ids) and source <> 'backfill' and status in ('released', 'signed_up', 'verified');
  get diagnostics v_n = row_count;
  return jsonb_build_object('changed', v_n, 'skipped', array_length(p_ids, 1) - v_n);
end;
$$;
revoke all on function public.admin_set_founding_wave(uuid[], integer) from public, anon;
grant execute on function public.admin_set_founding_wave(uuid[], integer) to authenticated;

create or replace function public.admin_mark_founding_messaged(p_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can do this' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('released', 'verified', 'waiting') then
    raise exception 'Choose released, verified or waiting' using errcode = '22023';
  end if;
  update public.founding_tutors_list
     set released_messaged_at = case when p_kind = 'released' then now() else released_messaged_at end,
         verified_messaged_at = case when p_kind = 'verified' then now() else verified_messaged_at end,
         waiting_messaged_at = case when p_kind = 'waiting' then now() else waiting_messaged_at end,
         last_contacted_at = now()
   where id = p_id;
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_mark_founding_messaged(uuid, text) from public, anon;
grant execute on function public.admin_mark_founding_messaged(uuid, text) to authenticated;

create or replace function public.admin_mark_founding_contacted(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can do this' using errcode = '42501';
  end if;
  update public.founding_tutors_list set last_contacted_at = now() where id = p_id and source <> 'backfill';
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_mark_founding_contacted(uuid) from public, anon;
grant execute on function public.admin_mark_founding_contacted(uuid) to authenticated;

create or replace function public.admin_set_founding_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can do this' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('joined', 'released', 'signed_up', 'verified') then
    raise exception 'Choose joined, released, signed_up or verified' using errcode = '22023';
  end if;
  update public.founding_tutors_list
     set status = p_status,
         released_at = case when p_status = 'joined' then null else coalesce(released_at, now()) end,
         released_messaged_at = case when p_status = 'joined' then null else released_messaged_at end,
         wave = case when p_status = 'joined' then null else wave end,
         lapsed_at = null,
         delete_after = case
           when p_status = 'joined' then created_at + interval '6 months'
           when p_status = 'released' then coalesce(released_at, now()) + interval '30 days'
           else null end
   where id = p_id;
  if not found then raise exception 'No such entry' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;
revoke all on function public.admin_set_founding_status(uuid, text) from public, anon;
grant execute on function public.admin_set_founding_status(uuid, text) to authenticated;

create or replace function public.admin_add_founding_entry(p_full_name text, p_code_name text, p_whatsapp text, p_email text, p_status text default 'released')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wa text := public.tidy_za_mobile(p_whatsapp);
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_name text := btrim(coalesce(p_full_name, ''), E' \t\r\n');
  v_code text := btrim(coalesce(p_code_name, ''), E' \t\r\n');
  v_id uuid;
begin
  if not public.founding_admin_ok() then
    raise exception 'Only a verification officer or a super admin can add people' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 or char_length(v_code) < 1 or char_length(v_code) > 30 then
    raise exception 'Enter a full name and the name for the link' using errcode = '22023';
  end if;
  if v_wa is null then raise exception 'That is not a South African mobile number' using errcode = '22023'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('joined', 'released', 'verified') then
    raise exception 'Choose joined, released or verified' using errcode = '22023';
  end if;
  insert into public.founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, is_adult, consent_version, status, released_at, delete_after, wave)
  values ('admin', v_name, v_code, v_wa, v_email, v_email, true, 'added-by-admin', p_status,
          case when p_status = 'joined' then null else now() end,
          case p_status when 'joined' then now() + interval '6 months' when 'released' then now() + interval '30 days' else null end,
          case when p_status = 'joined' then null else 1 end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then raise exception 'That email is already on the list' using errcode = '23505'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.admin_add_founding_entry(text, text, text, text, text) from public, anon;
grant execute on function public.admin_add_founding_entry(text, text, text, text, text) to authenticated;

-- the daily job also removes last-field rows older than 90 days (like the page counts)
create or replace function public.founding_daily_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lapsed integer := public.lapse_founding_releases();
  v_purged jsonb := public.purge_expired_founding_entries();
  v_fields integer;
begin
  delete from public.founding_form_fields where updated_at < now() - interval '90 days';
  get diagnostics v_fields = row_count;
  return v_purged || jsonb_build_object('lapsed', v_lapsed, 'fields_deleted', v_fields);
end;
$$;
revoke all on function public.founding_daily_job() from public, anon, authenticated, service_role;
