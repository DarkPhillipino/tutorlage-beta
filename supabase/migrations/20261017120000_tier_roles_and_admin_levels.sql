-- Levels and who is at them, run from the admin app (CEO, 17 Oct 2026): "admins should be able to assign tier roles from the admin
-- app and the tiers should be defined in the admin app as well". Test: supabase/tests/tier_roles_admin.sql.
--
-- What this adds (nothing is dropped; ONE existing function is replaced, refresh_credential_floor, so it can read a level an admin
-- chose for one tutor):
--   * tutor_credentials.assigned_sub_tier_id and .note: a verified credential may carry its own level and the reason for it.
--   * credential_definitions.entry_sub_tier_id may be empty (the level is then set per tutor by an admin).
--   * Nine admin-only functions that do the work AND write the audit row: admin_assign_tier, admin_clear_assigned_tier,
--     admin_record_credential, admin_remove_credential, admin_save_tier, admin_save_sub_tier, admin_save_credential_definition,
--     admin_delete_credential_definition, admin_recalculate_all_tiers.
--   * New credential definitions: a teaching degree or PGCE (2C), the same with 2, 3 and 4 or more years in the classroom (2D, 3A, 3B),
--     a Higher Certificate in Education (2A), and "level assigned by Tutorlage" (no level of its own). The CEO can change every one of
--     these in the admin app.
--
-- A tutor's level is still the higher of what they have earned on Tutorlage and their credential floor; the floor is still derived
-- only from verified, in-date credentials (never typed in), and a rating freeze still stops all movement.

alter table public.credential_definitions alter column entry_sub_tier_id drop not null;

alter table public.tutor_credentials
  add column if not exists assigned_sub_tier_id varchar references public.sub_tier_definitions(id),
  add column if not exists note text;

create or replace function public.refresh_credential_floor(p_tutor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor varchar;
begin
  select s.id into v_floor
  from public.tutor_credentials c
  join public.credential_definitions d on d.code = c.credential_code
  join public.sub_tier_definitions s on s.id = coalesce(c.assigned_sub_tier_id, d.entry_sub_tier_id)
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

insert into public.credential_definitions (code, label, entry_sub_tier_id, recency_years, description) values
  ('teaching_degree', 'Qualified teacher with a teaching degree or PGCE', '2C', null,
   'A completed teaching degree (for example a 4-year B.Ed) or a PGCE.'),
  ('teaching_degree_2y', 'Qualified teacher with 2 or more years in the classroom', '2D', null,
   'A teaching degree or PGCE and at least 2 years of classroom teaching, shown by an employment or reference letter.'),
  ('teaching_degree_3y', 'Qualified teacher with 3 or more years in the classroom', '3A', null,
   'A teaching degree or PGCE and at least 3 years of classroom teaching, shown by an employment or reference letter.'),
  ('teaching_degree_4y', 'Qualified teacher with 4 or more years in the classroom', '3B', null,
   'A teaching degree or PGCE and at least 4 years of classroom teaching, shown by an employment or reference letter.'),
  ('higher_certificate_education', 'Higher Certificate in Education', '2A', null,
   'A completed one-year Higher Certificate in Education.'),
  ('admin_assigned', 'Level assigned by Tutorlage', null, null,
   'A level an administrator chose for one tutor, with the reason. Not a credential the tutor can claim.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- Who is at which level
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_assign_tier(p_tutor uuid, p_sub_tier text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;
  if not exists (select 1 from public.sub_tier_definitions where id = p_sub_tier) then
    raise exception 'No such level';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Give the reason for this level';
  end if;
  delete from public.tutor_credentials where tutor_id = p_tutor and credential_code = 'admin_assigned';
  insert into public.tutor_credentials
    (tutor_id, credential_code, status, assigned_sub_tier_id, note, obtained_on, verified_by, verified_at)
  values (p_tutor, 'admin_assigned', 'verified', p_sub_tier, trim(p_reason), current_date, auth.uid(), now());
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'assign_level', 'sub_tier', p_sub_tier, 'reason', trim(p_reason)));
end;
$$;

create or replace function public.admin_clear_assigned_tier(p_tutor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Give the reason';
  end if;
  delete from public.tutor_credentials where tutor_id = p_tutor and credential_code = 'admin_assigned';
  if not found then
    raise exception 'This tutor has no assigned level';
  end if;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'clear_assigned_level', 'reason', trim(p_reason)));
end;
$$;

create or replace function public.admin_record_credential(
  p_tutor uuid, p_code text, p_obtained_on date, p_document uuid, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_entry varchar;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = p_tutor) then
    raise exception 'No such tutor';
  end if;
  select entry_sub_tier_id into v_entry from public.credential_definitions where code = p_code;
  if not found then
    raise exception 'No such credential';
  end if;
  if p_code = 'admin_assigned' or v_entry is null then
    raise exception 'To set a level for this tutor use "Assign a level"';
  end if;
  if p_document is not null and not exists (
    select 1 from public.tutor_verification_documents where id = p_document and tutor_id = p_tutor
  ) then
    raise exception 'That document does not belong to this tutor';
  end if;
  insert into public.tutor_credentials
    (tutor_id, credential_code, document_id, status, obtained_on, note, verified_by, verified_at)
  values (p_tutor, p_code, p_document, 'verified', p_obtained_on, nullif(trim(p_note), ''), auth.uid(), now())
  returning id into v_id;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', p_tutor,
    jsonb_build_object('action', 'record_credential', 'credential', p_code, 'level', v_entry, 'obtained_on', p_obtained_on));
  return v_id;
end;
$$;

create or replace function public.admin_remove_credential(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_code text;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Give the reason';
  end if;
  delete from public.tutor_credentials where id = p_id returning tutor_id, credential_code into v_tutor, v_code;
  if not found then
    raise exception 'No such credential';
  end if;
  perform public.log_admin_event('manual_tier_override', 'tutor_profiles', v_tutor,
    jsonb_build_object('action', 'remove_credential', 'credential', v_code, 'reason', trim(p_reason)));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- The levels themselves
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_tier(
  p_id integer, p_public_name text, p_quote text, p_min_rate numeric, p_max_rate numeric, p_commission numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_id is null or p_id < 1 then
    raise exception 'A tier needs a number';
  end if;
  if coalesce(length(trim(p_public_name)), 0) < 2 then
    raise exception 'A tier needs a name';
  end if;
  if p_min_rate is null or p_max_rate is null or p_min_rate < 0 or p_max_rate < p_min_rate then
    raise exception 'The rates must be numbers, the highest not below the lowest';
  end if;
  if p_commission is null or p_commission < 0 or p_commission > 100 then
    raise exception 'Commission is a percentage from 0 to 100';
  end if;
  select to_jsonb(t) - 'created_at' into v_before from public.tier_definitions t where t.id = p_id;
  insert into public.tier_definitions (id, public_name, positioning_quote, min_rate, max_rate, commission_rate_pct)
  values (p_id, trim(p_public_name), trim(coalesce(p_quote, '')), p_min_rate, p_max_rate, p_commission)
  on conflict (id) do update
    set public_name = excluded.public_name, positioning_quote = excluded.positioning_quote,
        min_rate = excluded.min_rate, max_rate = excluded.max_rate, commission_rate_pct = excluded.commission_rate_pct;
  perform public.log_admin_event('system_setting_updated', 'tier_definitions', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('entity', 'tier', 'id', p_id, 'before', v_before,
      'after', jsonb_build_object('public_name', trim(p_public_name), 'positioning_quote', trim(coalesce(p_quote, '')),
        'min_rate', p_min_rate, 'max_rate', p_max_rate, 'commission_rate_pct', p_commission)));
end;
$$;

create or replace function public.admin_save_sub_tier(
  p_id text, p_tier_id integer, p_price numeric, p_min_hours integer, p_min_rating numeric, p_min_repeat numeric,
  p_min_reviews integer, p_min_students integer, p_uplift numeric, p_commission numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := upper(trim(coalesce(p_id, '')));
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if v_id !~ '^[0-9][A-Z]$' then
    raise exception 'A level is named by its tier number and a letter, for example 2C';
  end if;
  if not exists (select 1 from public.tier_definitions where id = p_tier_id) then
    raise exception 'No such tier';
  end if;
  if p_price is null or p_price <= 0 or p_price > 100000 then
    raise exception 'The price must be more than 0';
  end if;
  if coalesce(p_min_hours, -1) < 0 or coalesce(p_min_reviews, -1) < 0 or coalesce(p_min_students, -1) < 0 then
    raise exception 'Hours, reviews and learners cannot be negative';
  end if;
  if p_min_rating is null or p_min_rating < 0 or p_min_rating > 5 then
    raise exception 'The rating is from 0 to 5';
  end if;
  if p_min_repeat is null or p_min_repeat < 0 or p_min_repeat > 100 or p_uplift is null or p_uplift < 0 or p_uplift > 100 then
    raise exception 'Percentages are from 0 to 100';
  end if;
  if p_commission is null or p_commission < 0 or p_commission > 100 then
    raise exception 'Commission is a percentage from 0 to 100';
  end if;
  select to_jsonb(s) - 'created_at' into v_before from public.sub_tier_definitions s where s.id = v_id;
  insert into public.sub_tier_definitions
    (id, tier_id, sub_tier_code, max_allowed_rate, min_hours, min_rating, min_repeat_rate_pct, min_written_reviews,
     min_distinct_students_uplift, required_grade_uplift_pct, commission_rate_pct)
  values (v_id, p_tier_id, right(v_id, 1), p_price, p_min_hours, p_min_rating, p_min_repeat, p_min_reviews,
          p_min_students, p_uplift, p_commission)
  on conflict (id) do update
    set tier_id = excluded.tier_id, max_allowed_rate = excluded.max_allowed_rate, min_hours = excluded.min_hours,
        min_rating = excluded.min_rating, min_repeat_rate_pct = excluded.min_repeat_rate_pct,
        min_written_reviews = excluded.min_written_reviews, min_distinct_students_uplift = excluded.min_distinct_students_uplift,
        required_grade_uplift_pct = excluded.required_grade_uplift_pct, commission_rate_pct = excluded.commission_rate_pct;
  perform public.log_admin_event('system_setting_updated', 'sub_tier_definitions', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('entity', 'level', 'id', v_id, 'before', v_before,
      'after', jsonb_build_object('tier_id', p_tier_id, 'price', p_price, 'min_hours', p_min_hours, 'min_rating', p_min_rating,
        'min_repeat_rate_pct', p_min_repeat, 'min_reviews', p_min_reviews, 'min_students_uplift', p_min_students,
        'required_uplift_pct', p_uplift, 'commission_rate_pct', p_commission)));
end;
$$;

create or replace function public.admin_save_credential_definition(
  p_code text, p_label text, p_entry_sub_tier text, p_recency_years integer, p_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if v_code !~ '^[a-z][a-z0-9_]{2,40}$' then
    raise exception 'A credential code is lower-case letters, digits and underscores, 3 to 41 characters';
  end if;
  if v_code = 'admin_assigned' then
    raise exception 'That credential is built in';
  end if;
  if coalesce(length(trim(p_label)), 0) < 3 then
    raise exception 'A credential needs a name';
  end if;
  if p_entry_sub_tier is null or not exists (select 1 from public.sub_tier_definitions where id = p_entry_sub_tier) then
    raise exception 'Choose the level this credential starts a tutor at';
  end if;
  if p_recency_years is not null and (p_recency_years < 1 or p_recency_years > 50) then
    raise exception 'Years of validity must be from 1 to 50, or empty';
  end if;
  select to_jsonb(d) into v_before from public.credential_definitions d where d.code = v_code;
  insert into public.credential_definitions (code, label, entry_sub_tier_id, recency_years, description)
  values (v_code, trim(p_label), p_entry_sub_tier, p_recency_years, nullif(trim(coalesce(p_description, '')), ''))
  on conflict (code) do update
    set label = excluded.label, entry_sub_tier_id = excluded.entry_sub_tier_id,
        recency_years = excluded.recency_years, description = excluded.description;
  -- A changed starting level moves everyone who holds a verified credential of this kind.
  perform public.refresh_credential_floor(c.tutor_id) from public.tutor_credentials c
    where c.credential_code = v_code and c.status = 'verified';
  perform public.log_admin_event('system_setting_updated', 'credential_definitions', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('entity', 'credential', 'code', v_code, 'before', v_before,
      'after', jsonb_build_object('label', trim(p_label), 'entry_sub_tier_id', p_entry_sub_tier, 'recency_years', p_recency_years)));
end;
$$;

create or replace function public.admin_delete_credential_definition(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_code = 'admin_assigned' then
    raise exception 'That credential is built in';
  end if;
  if exists (select 1 from public.tutor_credentials where credential_code = p_code) then
    raise exception 'Tutors hold this credential, so it cannot be deleted. Change its level instead.';
  end if;
  delete from public.credential_definitions where code = p_code;
  if not found then
    raise exception 'No such credential';
  end if;
  perform public.log_admin_event('system_setting_updated', 'credential_definitions', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('entity', 'credential', 'code', p_code, 'action', 'deleted'));
end;
$$;

-- After the minimums or prices change, work out everyone's level again with the new numbers (a button in the admin app; nothing
-- here runs by itself, so a change never moves anyone until an admin says so, except through the next completed session).
create or replace function public.admin_recalculate_all_tiers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  for v_id in select id from public.tutor_profiles loop
    perform public.fn_recalculate_tutor_tier(v_id);
    v_n := v_n + 1;
  end loop;
  perform public.log_admin_event('system_setting_updated', 'tutor_profiles', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('action', 'recalculate_all_tiers', 'tutors', v_n));
  return v_n;
end;
$$;

revoke all on function
  public.admin_assign_tier(uuid, text, text),
  public.admin_clear_assigned_tier(uuid, text),
  public.admin_record_credential(uuid, text, date, uuid, text),
  public.admin_remove_credential(uuid, text),
  public.admin_save_tier(integer, text, text, numeric, numeric, numeric),
  public.admin_save_sub_tier(text, integer, numeric, integer, numeric, numeric, integer, integer, numeric, numeric),
  public.admin_save_credential_definition(text, text, text, integer, text),
  public.admin_delete_credential_definition(text),
  public.admin_recalculate_all_tiers()
from public, anon;
grant execute on function
  public.admin_assign_tier(uuid, text, text),
  public.admin_clear_assigned_tier(uuid, text),
  public.admin_record_credential(uuid, text, date, uuid, text),
  public.admin_remove_credential(uuid, text),
  public.admin_save_tier(integer, text, text, numeric, numeric, numeric),
  public.admin_save_sub_tier(text, integer, numeric, integer, numeric, numeric, integer, integer, numeric, numeric),
  public.admin_save_credential_definition(text, text, text, integer, text),
  public.admin_delete_credential_definition(text),
  public.admin_recalculate_all_tiers()
to authenticated;
