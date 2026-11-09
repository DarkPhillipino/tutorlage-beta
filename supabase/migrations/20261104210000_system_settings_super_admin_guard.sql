-- SYSTEM SETTINGS: ONLY A SUPER ADMIN CAN CHANGE A SETTING (P2 security, 4 Nov 2026).
-- The hole: the policy "Admins manage system settings" lets EVERY active admin (support agent and verification officer included) insert, change
-- and delete ANY system_settings row through the API. Only the wallet_ keys had a guard (wallet_settings_guard, wallet core migration
-- 20261102200100: finance_manager and super_admin). So a support agent could switch free sessions on or off, change the Terms version (which
-- tells every account), the cancellation window, the auto-complete hours or the matching widen time.
--
-- The rule after this migration, for a call that arrives through the API (the 'authenticated' / 'anon' roles; the owner running SQL, the
-- database's own SECURITY DEFINER functions and the server's service key are not stopped here, exactly as for the wallet guard):
--   * a setting whose key does NOT start with 'wallet_'  -> only an active super_admin may insert, change (any column, including renaming the
--     key) or delete it. Admin roles that exist: support_agent, verification_officer, finance_manager, super_admin. The admin app already shows
--     the System Settings page to super_admin only; the database now agrees with the screen.
--   * a setting whose key starts with 'wallet_' (and stays so) -> unchanged: wallet_settings_guard lets finance_manager and super_admin
--     change it, and checks the value. Moving a key into or out of the wallet_ names counts as touching a non-wallet key (super admin only).
--
-- WHAT THIS MIGRATION ADDS (it replaces and drops NOTHING that exists):
--   NEW  function public.settings_is_super_admin()        security definer helper; true only for an active super_admin; signed-in users may ask
--                                                           (it answers about themselves only), signed-out callers may not.
--   NEW  function public.system_settings_role_guard()     trigger function (SECURITY INVOKER on purpose: current_user is then the caller);
--                                                           closed to every role (a trigger needs no execute right to fire).
--   NEW  trigger  system_settings_role_guard on public.system_settings   BEFORE INSERT OR UPDATE OR DELETE, per row.
-- UNCHANGED and still live: policy "Admins manage system settings" (any active admin can still READ every setting), trigger
-- wallet_settings_guard / function wallet_settings_guard() (wallet_ keys), trigger wallet_bank_setting_changed, trigger
-- trg_policy_version_changed, function wallet_is_finance_admin().
-- Not changed on purpose: TRUNCATE (the REST API has no TRUNCATE), and nothing about who may READ settings.
-- The admin app needs no change to keep working for the CEO (he is a super_admin): the 'Add / Update Setting' box writes through the same call.

create or replace function public.settings_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles a
                 where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin');
$$;
revoke all on function public.settings_is_super_admin() from public, anon;
grant execute on function public.settings_is_super_admin() to authenticated;

create or replace function public.system_settings_role_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old text;
  v_new text;
begin
  -- Only a call that comes through the API is held to the rule (same test as wallet_settings_guard).
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- The keys this statement touches: the old key (not on insert) and the new key (not on delete).
  if tg_op <> 'INSERT' then v_old := old.setting_key; end if;
  if tg_op <> 'DELETE' then v_new := new.setting_key; end if;

  -- Wallet settings stay with wallet_settings_guard (finance admins and super admins) only when EVERY key touched is a wallet_ key.
  if (v_old is null or left(v_old, 7) = 'wallet_') and (v_new is null or left(v_new, 7) = 'wallet_') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.settings_is_super_admin() then
    raise exception 'Only a super admin can change system settings' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.system_settings_role_guard() from public, anon, authenticated, service_role;

drop trigger if exists system_settings_role_guard on public.system_settings;
create trigger system_settings_role_guard before insert or update or delete on public.system_settings
  for each row execute function public.system_settings_role_guard();
