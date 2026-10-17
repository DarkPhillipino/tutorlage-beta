-- When the current Terms of Service or Privacy Policy version changes, every account is told in the notification bell. Nobody is
-- stopped or signed out any more (CEO, 17 Oct 2026: "stop signing me out when new tos is created ... simply send a notification on
-- the site stating that the tos has been updated"). Adds one trigger function and one trigger; replaces nothing. Test:
-- supabase/tests/policy_update_notification.sql.
--
-- The app's gate (AccountGate) now stops only someone who has never accepted a document at all (a Google sign-up, an old account);
-- a changed version no longer brings anyone back to a screen. The Terms say that carrying on using Tutorlage after a change means
-- accepting the new version.
--
-- Changing a version is still done the same way (after the new page is live): update system_settings, key current_terms_version
-- and current_privacy_version. Both keys changing in one statement or one transaction gives each account ONE notice, not two.

create or replace function public.notify_policy_version_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.setting_key not in ('current_terms_version', 'current_privacy_version') then
    return new;
  end if;
  if new.setting_value is not distinct from old.setting_value then
    return new;
  end if;
  insert into public.notifications (profile_id, type, title, body)
  select p.id,
         'terms_updated',
         'We updated our Terms and Privacy Policy',
         'Tap to read them. You do not need to do anything: if you keep using Tutorlage you accept the new version, and if you do not agree you can close your account.'
  from public.profiles p
  -- created_at is the transaction's time, so a second changed key in the same statement or transaction adds nothing.
  where not exists (
    select 1 from public.notifications n
    where n.profile_id = p.id and n.type = 'terms_updated' and n.created_at = now()
  );
  return new;
end;
$$;

-- Only the trigger calls it.
revoke all on function public.notify_policy_version_changed() from public, anon, authenticated;

drop trigger if exists trg_policy_version_changed on public.system_settings;
create trigger trg_policy_version_changed
  after update of setting_value on public.system_settings
  for each row
  execute function public.notify_policy_version_changed();
