-- 2026-09-30 (third session). Found by a read-only check of what a signed-out visitor can read.
--
-- A signed-out (anon) read of tutor_profiles fails on both dev and production with
-- "permission denied for table parent_student_links", instead of returning the verified tutors that
-- the "Public can view verified tutor profiles" policy is meant to show. The chain: tutor_profiles'
-- "Students view tutors of their own sessions" policy (roles = public) looks into sessions; sessions'
-- "Parents view linked student sessions" policy (roles = public) looks into parent_student_links; anon
-- has no SELECT on parent_student_links, and policy expressions run with the caller's privileges.
--
-- No screen is broken today (every tutor_profiles read in src/ happens after sign-in), but any public
-- tutor listing would fail. Each policy below compares a row with auth.uid(), which is null for a
-- signed-out caller, so none of them can ever match anon. Scoping them to authenticated changes
-- nothing for signed-in users and stops anon from evaluating them.

alter policy "Students view tutors of their own sessions" on public.tutor_profiles to authenticated;
alter policy "Parents view linked student sessions" on public.sessions to authenticated;
alter policy "Parents can view linked student profiles" on public.student_profiles to authenticated;
alter policy "Parents view student enrollments" on public.student_subject_enrollments to authenticated;
