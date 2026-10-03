-- 2026-09-30 (second session). Backlog 7o — profiles were readable by anyone.
--
-- "Public profiles are viewable by everyone" (qual `true`) plus a SELECT grant to anon meant anyone
-- holding the publishable key — which ships in the public JS bundle — could list every account's
-- full name, email and phone number, including (once they join) learners under 18. POPIA s19
-- requires reasonable safeguards; this was none.
--
-- Now:
-- * Not signed in: no access to profiles at all (every screen that shows a profile is behind sign-in).
-- * Signed in: only names/avatars (no email, phone or date of birth), and only for profiles you have
--   a reason to see — yourself, verified tutors (the public listing), the other side of your own
--   sessions/requests, and your linked guardian/learner.
-- * Email and phone reach admins only through admin_profile_private() / admin_search_profiles().
--   The signed-in user's own email comes from their auth session, not this table.

create or replace function public.can_see_profile(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    p_id = auth.uid()
    or public.is_active_admin()
    or exists (select 1 from public.tutor_profiles t where t.id = p_id and t.is_verified)
    or exists (select 1 from public.sessions s
               where (s.tutor_id = auth.uid() and (s.student_id = p_id or s.booked_by_profile_id = p_id))
                  or (s.tutor_id = p_id and (s.student_id = auth.uid() or s.booked_by_profile_id = auth.uid())))
    or exists (select 1 from public.session_requests r
               where (r.tutor_id = auth.uid() and (r.student_id = p_id or r.requested_by_profile_id = p_id))
                  or (r.tutor_id = p_id and (r.student_id = auth.uid() or r.requested_by_profile_id = auth.uid())))
    or exists (select 1 from public.parent_student_links l
               where (l.parent_id = auth.uid() and l.student_id = p_id)
                  or (l.student_id = auth.uid() and l.parent_id = p_id))
  );
$$;
revoke all on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Profiles visible to people who deal with them" on public.profiles;
create policy "Profiles visible to people who deal with them" on public.profiles
  for select to authenticated using (public.can_see_profile(id));

revoke select on public.profiles from anon, authenticated;
grant select (id, role, full_name, avatar_url, created_at, updated_at) on public.profiles to authenticated;

-- Admin user search (replaces a direct profiles query that read and filtered on email).
create or replace function public.admin_search_profiles(p_term text)
returns table (id uuid, full_name text, email text, role public.user_role, created_at timestamptz,
               is_verified boolean, onboarding_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.email, p.role, p.created_at, t.is_verified, t.onboarding_status::text
    from public.profiles p
    left join public.tutor_profiles t on t.id = p.id
    where nullif(trim(p_term), '') is null
       or p.full_name ilike '%' || trim(p_term) || '%'
       or p.email ilike '%' || trim(p_term) || '%'
    order by p.created_at desc
    limit 50;
end;
$$;
revoke all on function public.admin_search_profiles(text) from public, anon;
grant execute on function public.admin_search_profiles(text) to authenticated;
