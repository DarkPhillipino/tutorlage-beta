-- Backlog item 3 (2026-09-30): the live tier descriptions shown on TierSelectionPage made claims
-- nothing backs ("certified educators", "Elite turnaround experts with a proven track record").
-- Replaced with marketing's true-today copy (Drake/marketing-gtm/site-copy-v1.md); Tier 1 renamed
-- from "Peer-to-Peer Tutors" to "Rising Tutors". Tier 1 uses the interim wording until item 7's
-- 70% check is live.
update public.tier_definitions set public_name = 'Rising Tutors',
  positioning_quote = 'Tutors new to Tutorlage, building their record.' where id = 1;
update public.tier_definitions set
  positioning_quote = 'Tutors with a strong record on Tutorlage — high ratings and students who keep coming back — or a teaching qualification.' where id = 2;
update public.tier_definitions set
  positioning_quote = 'Experienced tutors, including qualified teachers who teach this subject to matric classes or lead it at their school.' where id = 3;
update public.tier_definitions set
  positioning_quote = 'Tutors who mark or moderate NSC, IEB or Cambridge exam papers, and our most established tutors.' where id = 4;
