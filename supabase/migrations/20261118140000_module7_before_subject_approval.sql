-- 18 Nov 2026, road to P5 item 7 (PM decided 17 Nov: yes; then HELD 18 Nov while the CEO is asked). Written, proven rolled back, NOT applied: waits for the PM's apply line.
-- REWORKED 18 Nov (replaces 20261118110000, which is deleted): it depends on 20261118130000, which put "may a subject be approved for this tutor yet?" in ONE function,
-- subject_approval_blocker(tutor). This migration changes only that function (plus the exemption below), so Module 7 is enforced on BOTH routes at once: the checklist
-- (admin_review_tutor_subject) and the teaching-credential route (admin_approve_subjects_on_credential). A rejection is never blocked. Subjects already verified stay verified;
-- only a NEW approval is held.
-- The rule (Educator, safeguarding): a tutor may teach a learner only after Module 7 (its four scenarios all right) and the acceptance of the Tutor Code of Conduct; public.tier1_training_complete
-- already follows the setting tier1_route ('documents' = Module 7 + conduct tick; 'full' = all modules).
--
-- ADDED 18 Nov after the CEO's order: Odi, Amree (Ammaar) and Amira are TEMPORARILY EXEMPT while they set up their accounts. A temporary, per-person exemption with an END DATE, as data:
--   NEW table    module7_exemptions             one row per person: keyed to the tutor's account OR (before the account exists) to the founding-list row (src tag such as ceo-odi);
--                                               a list-row exemption applies to whichever account that row is later linked to. ends_at is required; the exemption stops by itself after it.
--                                               No policy and no right for any API role: it is read and written only through the functions below.
--   NEW function module7_exemption_active(tutor)  internal (nobody can call it); the blocker uses it.
--   NEW function admin_grant_module7_exemption(tutor, list tag, days default 30, reason)   verification officer or super admin; 1 to 90 days; granting again replaces the end date (that is "adjust").
--   NEW function admin_end_module7_exemption(tutor, list tag)                              same admins; ends it now.
--   NEW function admin_module7_exemption(tutor)    any active admin: what the tutor's page shows (active or not, end date, who granted it).
--   NEW function founding_grant_module7_exemption(key, days default 30)   SERVICE KEY ONLY (the seeding step): by list tag or email.
-- A tutor cannot grant it to themself: no right to the table, and the admin functions check the admin role inside. Nothing about what a wave recipient sees changes.
-- Rollback: Drake/programmer/rollbacks/20261118140000_module7_before_subject_approval_ROLLBACK.sql

-- 1. the exemption data ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.module7_exemptions (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid unique references public.tutor_profiles(id) on delete cascade,
  list_row_id uuid unique references public.founding_tutors_list(id) on delete cascade,
  ends_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 300),
  granted_via text not null default 'admin' check (granted_via in ('admin', 'seeding')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  constraint module7_exemptions_one_target check (num_nonnulls(tutor_id, list_row_id) = 1)
);
alter table public.module7_exemptions enable row level security;
revoke all on table public.module7_exemptions from public, anon, authenticated, service_role;

create or replace function public.module7_exemption_active(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.module7_exemptions e
    where e.ends_at > now()
      and (e.tutor_id = p_tutor
           or e.list_row_id in (select f.id from public.founding_tutors_list f where f.user_id = p_tutor))
  );
$$;
revoke all on function public.module7_exemption_active(uuid) from public, anon, authenticated, service_role;

-- 2. the one shared check, now with the exemption ---------------------------------------------------------------------------------------------------------
create or replace function public.subject_approval_blocker(p_tutor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.tier1_training_complete(p_tutor) or public.module7_exemption_active(p_tutor) then null
              else 'This tutor has not finished Module 7 and accepted the Tutor Code of Conduct yet, so a subject cannot be approved.' end;
$$;
revoke all on function public.subject_approval_blocker(uuid) from public, anon, authenticated, service_role;

-- 3. who sets it ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_grant_module7_exemption(p_tutor uuid default null, p_list_src text default null, p_days integer default 30, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Temporary exemption while the account is set up');
  v_ends timestamptz;
  v_tutor uuid := p_tutor;
  v_list uuid;
  k text := lower(btrim(coalesce(p_list_src, '')));
  n integer;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can set this' using errcode = '42501';
  end if;
  if num_nonnulls(p_tutor, nullif(k, '')) <> 1 then
    raise exception 'Name either the tutor or the list tag, not both and not neither' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'The exemption must be between 1 and 90 days' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'The reason is too long (300 characters at most)' using errcode = '22023';
  end if;
  if v_tutor is not null then
    if not exists (select 1 from public.tutor_profiles where id = v_tutor) then
      raise exception 'No such tutor';
    end if;
  else
    select count(*) into n from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
    if n = 0 then raise exception 'No list row has the tag "%"', k; end if;
    if n > 1 then raise exception 'More than one list row matches "%". Use the person''s email address instead.', k; end if;
    select f.id, f.user_id into v_list, v_tutor from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
    if v_tutor is not null then v_list := null; end if;   -- the person already has an account: key it to the account
  end if;
  v_ends := now() + make_interval(days => p_days);
  if v_tutor is not null then
    insert into public.module7_exemptions (tutor_id, ends_at, reason, granted_via, granted_by, granted_at)
    values (v_tutor, v_ends, v_reason, 'admin', auth.uid(), now())
    on conflict (tutor_id) do update set ends_at = excluded.ends_at, reason = excluded.reason, granted_via = 'admin', granted_by = excluded.granted_by, granted_at = excluded.granted_at;
  else
    insert into public.module7_exemptions (list_row_id, ends_at, reason, granted_via, granted_by, granted_at)
    values (v_list, v_ends, v_reason, 'admin', auth.uid(), now())
    on conflict (list_row_id) do update set ends_at = excluded.ends_at, reason = excluded.reason, granted_via = 'admin', granted_by = excluded.granted_by, granted_at = excluded.granted_at;
  end if;
  perform public.log_admin_event('system_setting_updated', 'module7_exemptions', coalesce(v_tutor, v_list),
    jsonb_build_object('kind', 'module7_exemption_granted', 'tutor_id', v_tutor, 'list_row_id', v_list, 'days', p_days, 'ends_at', v_ends, 'reason', v_reason));
  return jsonb_build_object('ends_at', v_ends, 'days', p_days, 'target', case when v_tutor is not null then 'tutor' else 'list_row' end);
end;
$$;
revoke all on function public.admin_grant_module7_exemption(uuid, text, integer, text) from public, anon;
grant execute on function public.admin_grant_module7_exemption(uuid, text, integer, text) to authenticated;

create or replace function public.admin_end_module7_exemption(p_tutor uuid default null, p_list_src text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_list_src, '')));
  n integer;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can set this' using errcode = '42501';
  end if;
  if num_nonnulls(p_tutor, nullif(k, '')) <> 1 then
    raise exception 'Name either the tutor or the list tag, not both and not neither' using errcode = '22023';
  end if;
  update public.module7_exemptions e set ends_at = now()
   where e.ends_at > now()
     and (e.tutor_id = p_tutor
          or e.list_row_id in (select f.id from public.founding_tutors_list f
                                where f.source in ('form', 'admin') and (f.src = k or f.email_key = k or (p_tutor is not null and f.user_id = p_tutor))));
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_admin_event('system_setting_updated', 'module7_exemptions', coalesce(p_tutor, gen_random_uuid()),
      jsonb_build_object('kind', 'module7_exemption_ended', 'tutor_id', p_tutor, 'list_tag', nullif(k, ''), 'rows', n));
  end if;
  return n;
end;
$$;
revoke all on function public.admin_end_module7_exemption(uuid, text) from public, anon;
grant execute on function public.admin_end_module7_exemption(uuid, text) to authenticated;

-- 4. what the tutor's page shows ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_module7_exemption(p_tutor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select e.ends_at, e.reason, e.granted_via, e.granted_at, e.ends_at > now() as active into r
    from public.module7_exemptions e
   where e.tutor_id = p_tutor or e.list_row_id in (select f.id from public.founding_tutors_list f where f.user_id = p_tutor)
   order by e.ends_at desc
   limit 1;
  if not found then return null; end if;
  return jsonb_build_object('active', r.active, 'ends_at', r.ends_at, 'reason', r.reason, 'granted_via', r.granted_via, 'granted_at', r.granted_at);
end;
$$;
revoke all on function public.admin_module7_exemption(uuid) from public, anon;
grant execute on function public.admin_module7_exemption(uuid) to authenticated;

-- 5. the seeding step (the CEO's account tool, service key only) ----------------------------------------------------------------------------------------
create or replace function public.founding_grant_module7_exemption(p_key text, p_days integer default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_key, '')));
  n integer;
  r public.founding_tutors_list%rowtype;
  v_ends timestamptz;
begin
  if k = '' then raise exception 'Name the list tag or the email' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'The exemption must be between 1 and 90 days' using errcode = '22023';
  end if;
  select count(*) into n from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
  if n = 0 then raise exception 'No list row has the tag or email "%"', k; end if;
  if n > 1 then raise exception 'More than one list row matches "%". Use the person''s email address instead.', k; end if;
  select * into r from public.founding_tutors_list f where f.source in ('form', 'admin') and (f.src = k or f.email_key = k);
  v_ends := now() + make_interval(days => p_days);
  if r.user_id is not null then
    insert into public.module7_exemptions (tutor_id, ends_at, reason, granted_via, granted_at)
    values (r.user_id, v_ends, 'Temporary exemption while the account is set up', 'seeding', now())
    on conflict (tutor_id) do update set ends_at = excluded.ends_at, reason = excluded.reason, granted_via = 'seeding', granted_by = null, granted_at = excluded.granted_at;
  else
    insert into public.module7_exemptions (list_row_id, ends_at, reason, granted_via, granted_at)
    values (r.id, v_ends, 'Temporary exemption while the account is set up', 'seeding', now())
    on conflict (list_row_id) do update set ends_at = excluded.ends_at, reason = excluded.reason, granted_via = 'seeding', granted_by = null, granted_at = excluded.granted_at;
  end if;
  return jsonb_build_object('ok', true, 'ends_at', v_ends, 'days', p_days);
end;
$$;
revoke all on function public.founding_grant_module7_exemption(text, integer) from public, anon, authenticated;
grant execute on function public.founding_grant_module7_exemption(text, integer) to service_role;
