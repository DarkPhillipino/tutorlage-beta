-- Deleting an Auth user must not delete the profile row of a CLOSED account (companion of 20261021140000_close_account.sql; its own yes).
-- Today profiles.id references auth.users ON DELETE CASCADE, so removing a person's sign-in removes their profile and, through it, bookings,
-- payments and consents that legal says must be kept for years. The close-account tool must delete the Auth user (Privacy §14: sign-in
-- deleted by day 90) and keep the profile row, so:
--   * the foreign key is dropped; and
--   * an after-delete trigger on auth.users does by hand what the cascade did, EXCEPT for an account that has a tombstone (closed through
--     the tool, day-30 deletion done), whose profile row stays. For every other account the behaviour is exactly as before, including the
--     refusal when the person still has sessions (the profile delete hits the same foreign keys and aborts the Auth delete).
-- The close-account tool refuses to hand the Worker an Auth-delete step until this migration is in (closure_auth_link_is_safe()).
-- auth.users is owned by supabase_auth_admin, so the trigger is made with "create or replace" (needs only the TRIGGER right the
-- migration role has; "drop trigger" would need ownership).

alter table public.profiles drop constraint if exists profiles_id_fkey;

create or replace function public.keep_closed_profile_after_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.account_tombstones t where t.profile_id = old.id) then
    return old;
  end if;
  delete from public.profiles where id = old.id;
  return old;
end;
$$;
revoke all on function public.keep_closed_profile_after_auth_delete() from public, anon, authenticated, service_role;

create or replace trigger keep_closed_profile_after_auth_delete after delete on auth.users
  for each row execute function public.keep_closed_profile_after_auth_delete();
