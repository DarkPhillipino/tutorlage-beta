-- LEVELS: WHO MAY CHANGE PRICES, CREDENTIAL DEFINITIONS AND A TUTOR'S LEVEL (P2 security round 2, group 1, 16 Nov 2026).
-- The hole (found 4 Nov, confirmed read-only on production 16 Nov): the nine "Levels" functions only check public.is_active_admin(), so ANY active
-- admin (a support agent too) can run them through the API even though the admin app shows the Levels menu to the super admin only. Five of them
-- edit the price ladder and the credential definitions; the table credential_definitions also carries a FOR ALL admin policy that lets any
-- active admin write it directly, with no audit row.
--
-- WHAT THIS MIGRATION DOES
--  1. ADDS public.admin_role_in(text[]): true when the caller is an ACTIVE admin whose role is in the list. SECURITY DEFINER with search_path = public,
--     the same shape as public.is_active_admin() and public.settings_is_super_admin(), so it can sit inside a policy without recursing into
--     admin_profiles's own policy. Execute: signed-in users only (revoked from public and anon). Later groups of this round re-use it.
--  2. REPLACES (CREATE OR REPLACE, same name, same arguments, same return type, same body, same grants; ONE added check each) nine functions:
--       the FIVE that edit the ladder and the definitions: admin_save_tier, admin_save_sub_tier, admin_save_credential_definition,
--         admin_delete_credential_definition, admin_recalculate_all_tiers      -> now super_admin only
--       the FOUR that act on ONE tutor: admin_assign_tier, admin_clear_assigned_tier, admin_record_credential, admin_remove_credential
--         -> now verification_officer or super_admin (the Level card sits on the Tutor Verification page, which only those two roles see)
--     The first check (is_active_admin -> 'Admins only', code 42501) is unchanged, so a non-admin still gets the same words as before.
--     The second check is new: 'Only a super admin can change prices, levels or credential definitions' / 'Only a verification officer or a super admin
--     can change a tutor''s level' (code 42501).
--  3. DROPS the policy "Admins manage credential definitions" on public.credential_definitions (FOR ALL, any active admin). Nothing else is dropped:
--     the policy "Anyone can read credential definitions" (SELECT, true) stays, so every read (tutor sign-up, the booking screens, the admin Levels page)
--     is unchanged. Every write already goes through admin_save_credential_definition / admin_delete_credential_definition (SECURITY DEFINER, run as the
--     owner, so they do not need the admin's row rights; test F1 proves it).
-- tier_definitions and sub_tier_definitions have NO write policy for any signed-in role (read on production 16 Nov), so the functions were already
-- their only write path: nothing to drop there.
-- Untouched: every other function, trigger and policy; the grants on the nine functions (CREATE OR REPLACE keeps them); the audit calls.

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

-- ---- the five that change the ladder and the definitions: super admin only ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_tier(p_id integer, p_public_name text, p_quote text, p_min_rate numeric, p_max_rate numeric, p_commission numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change prices, levels or credential definitions' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_sub_tier(p_id text, p_tier_id integer, p_price numeric, p_min_hours integer, p_min_rating numeric, p_min_repeat numeric, p_min_reviews integer, p_min_students integer, p_uplift numeric, p_commission numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := upper(trim(coalesce(p_id, '')));
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change prices, levels or credential definitions' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_credential_definition(p_code text, p_label text, p_entry_sub_tier text, p_recency_years integer, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
  v_before jsonb;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change prices, levels or credential definitions' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_credential_definition(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change prices, levels or credential definitions' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_recalculate_all_tiers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change prices, levels or credential definitions' using errcode = '42501';
  end if;
  for v_id in select id from public.tutor_profiles loop
    perform public.fn_recalculate_tutor_tier(v_id);
    v_n := v_n + 1;
  end loop;
  perform public.log_admin_event('system_setting_updated', 'tutor_profiles', '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('action', 'recalculate_all_tiers', 'tutors', v_n));
  return v_n;
end;
$function$;

-- ---- the four that act on one tutor: verification officer or super admin --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_assign_tier(p_tutor uuid, p_sub_tier text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_clear_assigned_tier(p_tutor uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_credential(p_tutor uuid, p_code text, p_obtained_on date, p_document uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_entry varchar;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_credential(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tutor uuid;
  v_code text;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then
    raise exception 'Only a verification officer or a super admin can change a tutor''s level' using errcode = '42501';
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
$function$;

-- ---- the table: no direct admin write; the functions above are the only way in -------------------------------------------------------------------
drop policy if exists "Admins manage credential definitions" on public.credential_definitions;
