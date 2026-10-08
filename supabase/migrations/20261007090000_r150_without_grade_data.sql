-- R150 (level 1D) without grade data — master backlog 7bk.
--
-- Nothing on the site, the payments API or the admin app writes student_academic_records, so the 5%
-- average grade-uplift requirement made 1D (R150) unreachable for every tutor. The CEO, 2026-10-07:
-- "R150 without grade data (Recommended)". 1D keeps its hours, rating, repeat-rate and review
-- requirements; grade uplift counts from 2A (R180) up, once marks can be recorded.
update public.sub_tier_definitions
set required_grade_uplift_pct = 0
where id = '1D';
