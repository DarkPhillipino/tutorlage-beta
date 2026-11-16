-- SYSTEM SETTINGS: A SECRET CAN NO LONGER BE SAVED THERE (P2 security round 2, group 6a, 16 Nov 2026).
-- Why: every signed-in user, and today even a signed-out visitor (policy "Public view non-sensitive system settings", SELECT, true, role public), can
-- read public.system_settings. A secret saved there (a key, a token, a password, a signing secret) would be public. Read-only check on production on
-- 16 Nov: 63 settings, none is a secret (the closing worker's address is a public workers.dev address; the secret that goes with it lives elsewhere).
-- This is the lock so it stays that way: a trigger refuses any insert or update, by ANY caller (the owner included, and the SQL editor), whose key
-- names a secret or whose value looks like one. It refuses the WRITE; it removes nothing and changes nothing already saved.
--   key refused when it contains (as whole words between underscores or at an end): secret, token, password, passwd, private_key, api_key, apikey,
--     service_role, signing_key, access_key, client_secret
--   value refused when it contains: a Stripe/Paystack-style secret key (sk_live_ or sk_test_ and 10+ characters), whsec_, sb_secret_, a JSON web token
--     (three dot-separated blocks starting eyJ), a PEM private key header, or a web address with a password in it (https://user:pass@host)
-- Untouched: every existing row, policy and trigger (system_settings_role_guard, wallet_settings_guard, the version triggers). Not SECURITY DEFINER: it
-- reads only the row being written.

create or replace function public.system_settings_no_secrets()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.setting_key ~* '(^|_)(secret|token|password|passwd|private_key|api_key|apikey|service_role|signing_key|access_key|client_secret)($|_)' then
    raise exception 'System settings can be read by every signed-in user. Do not save a secret here (setting "%").', new.setting_key
      using errcode = '42501';
  end if;
  if new.setting_value::text ~* '(sk_(live|test)_[a-z0-9]{10}|whsec_|sb_secret_|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|://[^/\s:@"]+:[^/\s@"]+@)' then
    raise exception 'The value of setting "%" looks like a secret. System settings can be read by every signed-in user.', new.setting_key
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.system_settings_no_secrets() from public, anon, authenticated;

drop trigger if exists system_settings_no_secrets on public.system_settings;
create trigger system_settings_no_secrets
  before insert or update on public.system_settings
  for each row execute function public.system_settings_no_secrets();
