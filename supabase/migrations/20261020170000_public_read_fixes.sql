-- Public read fixes, from the independent review of Production (20 Oct 2026): M1, M2, m1, m8, m9.
-- Additive or tightening only: no table or column is dropped, no data is touched.
--   M2  reviews: anyone could read every review with the reviewing learner's account id. The public list now comes from
--       public_tutor_reviews() (id, rating, comment, created_at only); the open policy is dropped; admins get their own policy.
--   M1  tutor_profiles: anyone could read a tutor's freeze reason, freeze flag, fast-track proof and credential floor. Those five
--       columns are no longer selectable by signed-out or signed-in users; admins read them through admin_tutor_internal_flags().
--       NOTE for later migrations: a NEW tutor_profiles column is not readable by the app until it is granted (grant select (col)).
--   m1  messaging tables are unused: signed-in users can no longer write to them.
--   m9  notifications: the owner can change read_at only.
--   m8  guard_verification_documents (REPLACED, rest of its logic unchanged): a stored file must sit in the tutor's own folder.
-- The app reads both ways (new function, or the old read when the function is missing), so this can be applied after the app is published.

-- M2 ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.public_tutor_reviews(p_tutor_id uuid)
returns table (id uuid, rating integer, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.rating, r.comment, r.created_at
  from public.reviews r
  where r.tutor_id = p_tutor_id
    and (p_tutor_id = auth.uid()
         or exists (select 1 from public.tutor_profiles t where t.id = p_tutor_id and t.is_verified))
  order by r.created_at desc
  limit 200;
$$;
revoke all on function public.public_tutor_reviews(uuid) from public, anon, authenticated;
grant execute on function public.public_tutor_reviews(uuid) to anon, authenticated;

drop policy if exists "Public can view reviews" on public.reviews;
revoke select on public.reviews from anon;
-- The admin app reads every review for its statistics; it used the open policy before.
drop policy if exists "Admins view all reviews" on public.reviews;
create policy "Admins view all reviews" on public.reviews for select to authenticated using (public.is_active_admin());

-- M1 ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_tutor_internal_flags(p_tutor uuid)
returns table (credential_floor_sub_tier_id varchar, tier_frozen boolean, freeze_reason text, fast_track_status text, fast_track_proof_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select t.credential_floor_sub_tier_id, t.tier_frozen, t.freeze_reason, t.fast_track_status::text, t.fast_track_proof_url
    from public.tutor_profiles t where t.id = p_tutor;
end;
$$;
revoke all on function public.admin_tutor_internal_flags(uuid) from public, anon, authenticated;
grant execute on function public.admin_tutor_internal_flags(uuid) to authenticated;

revoke select on public.tutor_profiles from anon, authenticated;
grant select (id, onboarding_status, is_verified, current_tier_id, current_sub_tier_id, hourly_rate, total_completed_hours,
              avg_rating, total_reviews_count, repeat_student_rate_pct, avg_grade_uplift_pct, qualified_uplift_students_count,
              updated_at, headline, teaching_mode, is_dispatch_active, total_sessions_completed, created_at, currency_code,
              institution_id)
  on public.tutor_profiles to anon, authenticated;

-- m1 ---------------------------------------------------------------------------------------------------------------------------
revoke insert, update, delete on public.conversations from authenticated;
revoke insert on public.messages from authenticated;

-- m9 ---------------------------------------------------------------------------------------------------------------------------
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- m8 ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_verification_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_active_admin() then
    return new;
  end if;
  -- A stored file must sit in the tutor's own folder (a web address is allowed: proof of experience can be a link).
  if (tg_op = 'INSERT' or new.document_url is distinct from old.document_url)
     and new.document_url !~* '^https?://'
     and (split_part(new.document_url, '/', 1) <> new.tutor_id::text or new.document_url like '%..%') then
    raise exception 'A document must be uploaded to your own folder' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.admin_notes := null;
    new.reviewed_at := null;
    return new;
  end if;
  if new.tutor_id is distinct from old.tutor_id then
    raise exception 'A document can''t be moved to another tutor' using errcode = '42501';
  end if;
  if new.document_url is distinct from old.document_url then
    new.status := 'pending';
    new.admin_notes := null;
    new.reviewed_at := null;
    return new;
  end if;
  if (new.status, new.admin_notes, new.reviewed_at) is distinct from (old.status, old.admin_notes, old.reviewed_at) then
    raise exception 'Only Tutorlage can review documents' using errcode = '42501';
  end if;
  return new;
end;
$$;
