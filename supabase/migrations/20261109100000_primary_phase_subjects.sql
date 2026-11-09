-- GRADE R TO 9 SUBJECTS (Monday queue item 2, 9 Nov 2026; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md sections 8.11 and 8.13;
-- the list and the reasons: Drake/educator/primary-phase-subjects-2026-11-09.md).
--
-- WHY. The `subjects` table (59 rows on production, 9 Nov) only holds Grade 10 to 12 style subjects, so a tutor who teaches Grades R to 9
-- cannot pick what she teaches. The table is only the suggestion list behind two text boxes (the tutor's "Subjects Taught" box and the
-- learner's subject box). Nothing is stored against it: no foreign key points at `subjects`, and no function reads it (checked on
-- production 9 Nov). A tutor's subject is saved as plain text in tutor_subject_competencies.subject_name, matched by name.
--
-- WHAT THIS ADDS: six rows, the DBE's CAPS names, and nothing else.
--     Economic and Management Sciences    Grades 7 to 9
--     Life Skills                         Grades R to 6
--     Natural Sciences                    Grades 7 to 9
--     Natural Sciences and Technology     Grades 4 to 6
--     Social Sciences                     Grades 4 to 9
--     Technology                          Grades 7 to 9
-- UNCHANGED: the 59 existing subjects, grade_levels (already runs from Grade R to Grade 12), every function, policy and trigger, the Tier 1
-- list (tier1_subjects stays at its 12 Grade 12 subjects: Tier 1 is the matric-results route and has no tests for these subjects).
--
-- SAFE TO RUN TWICE: a name is skipped if any row already has it, ignoring capitals and spaces at the ends (and ON CONFLICT covers a race).
-- The last statement stops the whole migration if any of the six is missing afterwards.

insert into public.subjects (name)
select v.name
from (values
  ('Economic and Management Sciences'),
  ('Life Skills'),
  ('Natural Sciences'),
  ('Natural Sciences and Technology'),
  ('Social Sciences'),
  ('Technology')
) as v(name)
where not exists (select 1 from public.subjects s where lower(btrim(s.name)) = lower(v.name))
on conflict (name) do nothing;

do $$
declare
  n integer;
begin
  select count(*) into n from public.subjects
   where name in ('Economic and Management Sciences', 'Life Skills', 'Natural Sciences',
                  'Natural Sciences and Technology', 'Social Sciences', 'Technology');
  if n <> 6 then
    raise exception 'Grade R to 9 subjects: expected 6 rows by exact name, found %', n;
  end if;
end $$;
