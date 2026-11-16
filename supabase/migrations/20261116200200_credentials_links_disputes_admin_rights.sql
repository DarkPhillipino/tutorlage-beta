-- TUTOR CREDENTIALS, PARENT-LEARNER LINKS AND DISPUTES: WHAT AN ADMIN MAY DO DIRECTLY (P2 security round 2, group 3, 16 Nov 2026).
-- The hole: three baseline policies are FOR ALL TO authenticated USING (public.is_active_admin()), so any active admin (a support agent too) can
-- read, insert, change and delete rows of all three tables through the API with no audit row:
--   public.tutor_credentials     "Admins manage tutor credentials"   (decides a tutor's level and so the price a learner pays; 0 rows today)
--   public.parent_student_links  "Admins manage student links"       (who is a learner's guardian: a link gives booking rights and contact; 1 row today)
--   public.platform_disputes     "Admins full control on disputes"   (a dispute can also be rewritten or deleted; 0 rows today)
-- What the admin app really does (read from admin/src on 16 Nov): it READS tutor_credentials (Levels page and the Level card on the Tutor Verification
-- page) and NEVER writes it directly (every level change goes through the admin_* functions of group 1, SECURITY DEFINER); it never touches
-- parent_student_links; it reads platform_disputes (Disputes page, alert counter, Phase 1 numbers) and UPDATES five columns on the Disputes page
-- (status, resolution_notes, refund_amount, resolved_at, assigned_admin_id). The Disputes menu entry is for support_agent and super_admin.
--
-- WHAT THIS MIGRATION DOES
--  1. Re-creates public.admin_role_in(text[]) (identical to group 1's, so the groups can be applied in any order).
--  2. tutor_credentials: DROP "Admins manage tutor credentials"; CREATE "Admins read tutor credentials" FOR SELECT TO authenticated USING
--     (admin_role_in(verification_officer, super_admin)), the two roles whose screens read it. No direct admin write at all.
--  3. parent_student_links: DROP "Admins manage student links"; CREATE "Admins read student links" FOR SELECT TO authenticated USING (is_active_admin()).
--     Reads unchanged for every admin; no direct admin write at all. "Parents view own links" and "Students can view parent links" stay.
--  4. platform_disputes: DROP "Admins full control on disputes"; CREATE "Admins read disputes" (SELECT, any active admin: the alert counter and the Phase 1
--     numbers read it) and "Support and super admins resolve disputes" (UPDATE only, support_agent or super_admin). No admin insert, no admin delete.
--     PLUS a trigger platform_disputes_admin_columns (BEFORE UPDATE, SECURITY INVOKER on purpose so current_user is the caller): a call through the API
--     may change only status, resolution_notes, refund_amount, resolved_at and assigned_admin_id; who raised the dispute, the session, the reason,
--     the words the person wrote, the date and the currency can no longer be rewritten. The owner, SECURITY DEFINER functions and the server key are not
--     held up (retention and closure functions keep working). "Users can view own disputes" stays.
-- Untouched: every other policy, function and table right; the server's service key.

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

-- ---- tutor_credentials ---------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins manage tutor credentials" on public.tutor_credentials;
drop policy if exists "Admins read tutor credentials" on public.tutor_credentials;
create policy "Admins read tutor credentials" on public.tutor_credentials
  for select to authenticated
  using (public.admin_role_in(array['verification_officer', 'super_admin']));

-- ---- parent_student_links ------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins manage student links" on public.parent_student_links;
drop policy if exists "Admins read student links" on public.parent_student_links;
create policy "Admins read student links" on public.parent_student_links
  for select to authenticated
  using (public.is_active_admin());

-- ---- platform_disputes ---------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins full control on disputes" on public.platform_disputes;
drop policy if exists "Admins read disputes" on public.platform_disputes;
create policy "Admins read disputes" on public.platform_disputes
  for select to authenticated
  using (public.is_active_admin());
drop policy if exists "Support and super admins resolve disputes" on public.platform_disputes;
create policy "Support and super admins resolve disputes" on public.platform_disputes
  for update to authenticated
  using (public.admin_role_in(array['support_agent', 'super_admin']))
  with check (public.admin_role_in(array['support_agent', 'super_admin']));

create or replace function public.platform_disputes_admin_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only a call made through the API is held (the owner, SECURITY DEFINER functions and the server key are not).
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.id, new.session_id, new.raised_by_id, new.reason, new.description, new.created_at, new.currency_code)
     is distinct from
     (old.id, old.session_id, old.raised_by_id, old.reason, old.description, old.created_at, old.currency_code) then
    raise exception 'A dispute''s session, reason and description cannot be changed; record the decision in the status, notes and refund amount'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.platform_disputes_admin_columns() from public, anon, authenticated;

drop trigger if exists platform_disputes_admin_columns on public.platform_disputes;
create trigger platform_disputes_admin_columns
  before update on public.platform_disputes
  for each row execute function public.platform_disputes_admin_columns();
