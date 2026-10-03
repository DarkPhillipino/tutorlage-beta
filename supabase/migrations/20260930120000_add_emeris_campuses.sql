-- Backlog 7d (2026-09-30): the institution seed covered public universities and TVET colleges only,
-- so The IIE's Emeris Waterfall — the CEO's first tutor cohort — couldn't be selected.
-- Source: Emeris's official campus list, https://www.emeris.ac.za/campuses (read 2026-09-30).
-- Emeris is an educational brand of The Independent Institute of Education (Pty) Ltd, registered with
-- DHET as a private higher education institution (reg. no. 2007/HE07/002). Its former brands
-- (Varsity College, IIE MSA, Vega, School of Hospitality and Service Management) now trade as Emeris.
-- Only the 11 physical campuses are added (the "Online" campus isn't a place to match on).
-- Other private providers should come from DHET's register, imported like the EMIS data — not typed
-- from memory.
insert into public.schools_institutions (name, institution_type, curriculum, curriculum_id, province, town_city, country_code)
select v.name, 'private_higher_education', 'tertiary', c.id, v.province, v.town_city, 'ZA'
from (values
  ('The IIE''s Emeris Waterfall Johannesburg', 'Gauteng', 'Midrand'),
  ('The IIE''s Emeris Sandton Johannesburg', 'Gauteng', 'Johannesburg'),
  ('The IIE''s Emeris Ruimsig Johannesburg', 'Gauteng', 'Johannesburg'),
  ('The IIE''s Emeris Pretoria Lynnwood', 'Gauteng', 'Pretoria'),
  ('The IIE''s Emeris Durban North', 'KwaZulu-Natal', 'Durban'),
  ('The IIE''s Emeris Durban Westville', 'KwaZulu-Natal', 'Durban'),
  ('The IIE''s Emeris Durban Umhlanga', 'KwaZulu-Natal', 'Durban'),
  ('The IIE''s Emeris Pietermaritzburg', 'KwaZulu-Natal', 'Pietermaritzburg'),
  ('The IIE''s Emeris Nelson Mandela Bay', 'Eastern Cape', 'Nelson Mandela Bay'),
  ('The IIE''s Emeris Cape Town City', 'Western Cape', 'Cape Town'),
  ('The IIE''s Emeris Cape Town Newlands', 'Western Cape', 'Cape Town')
) as v(name, province, town_city)
cross join (select id from public.curricula where code = 'TERTIARY') c
where not exists (select 1 from public.schools_institutions s where s.name = v.name);
