-- OPTIONAL (needs its own yes): SYSTEM SETTINGS READABLE ONLY BY SIGNED-IN USERS (P2 security round 2, group 6b, 16 Nov 2026).
-- Today policy "Public view non-sensitive system settings" is SELECT, using true, role public: a signed-out visitor with the public key can read ALL 63
-- settings through the API, including the Tutorlage bank account number the wallet shows to payers (wallet_bank_account_*), the retention periods and the
-- switches. Nothing signed-out needs them: the sign-up page reads the Terms and Privacy versions through current_policy_versions() and the launch switches
-- through free_sessions_open() / wallet_open(), all SECURITY DEFINER; no file in src/ queries the table (searched 16 Nov).
-- WHAT THIS MIGRATION REPLACES: DROP "Public view non-sensitive system settings"; CREATE "Signed-in users read system settings" (SELECT, role authenticated,
-- using true). Signed-in users read exactly what they read before; the admin policy "Admins manage system settings" and the guards are untouched.
-- If the CEO declines this one, group 6a still stands on its own.

drop policy if exists "Public view non-sensitive system settings" on public.system_settings;
drop policy if exists "Signed-in users read system settings" on public.system_settings;
create policy "Signed-in users read system settings" on public.system_settings
  for select to authenticated
  using (true);
