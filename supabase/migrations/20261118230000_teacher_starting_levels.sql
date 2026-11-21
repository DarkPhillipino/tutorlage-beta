-- 18 Nov 2026 (PM, second PM chat, written line of about 13:30, ITEM 6; the CEO: "qualified teachers begin in tier 3. head of department can be tier 3d. shift everything from qualified teachers up a level.
-- let a sace qualified teacher start in 2d. whether they can stay there is up to them"). A DATA change on SEVEN existing rows of credential_definitions: the credential floor (entry_sub_tier_id) of every
-- qualified-teacher credential moves up ONE level. Students and non-teacher credentials are unchanged. The level rule is unchanged (a tutor's level is the HIGHER of the earned level and the credential floor).
--   sace_registered_teacher 2C -> 2D      teaching_degree 2C -> 2D        teaching_degree_2y 2D -> 3A     sace_fet_subject_teacher 3A -> 3B
--   teaching_degree_3y 3A -> 3B           teaching_degree_4y 3B -> 3C     subject_leader 3C -> 3D
-- UNCHANGED: student_teacher_enrolled 1A, higher_certificate_education 2A, practicum_complete 2C, exam_marker 4A, exam_moderator_examiner 4B, admin_assigned (no level).
-- Each row changes only if it still holds the value it had on 18 Nov 2026 (read on production), and ALL seven must change or nothing does. Nobody holds any of the seven today (production has one credential row,
-- admin_assigned), so no tutor's level changes now; a tutor's floor is worked out from the definition when a credential is recorded or removed (refresh_credential_floor).
-- Rollback: Drake/programmer/rollbacks/20261118230000_teacher_starting_levels_ROLLBACK.sql
do $$
declare
  n integer;
begin
  update public.credential_definitions c
  set entry_sub_tier_id = v.new_level
  from (values
    ('sace_registered_teacher', '2C', '2D'),
    ('teaching_degree', '2C', '2D'),
    ('teaching_degree_2y', '2D', '3A'),
    ('sace_fet_subject_teacher', '3A', '3B'),
    ('teaching_degree_3y', '3A', '3B'),
    ('teaching_degree_4y', '3B', '3C'),
    ('subject_leader', '3C', '3D')
  ) as v (code, old_level, new_level)
  where c.code = v.code and c.entry_sub_tier_id = v.old_level;
  get diagnostics n = row_count;
  if n <> 7 then
    raise exception 'Expected to change 7 credential rows, changed %: nothing is changed', n;
  end if;
end $$;
