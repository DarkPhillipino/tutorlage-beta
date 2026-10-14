-- Master 7cx (tutor onboarding, phase 2): a new kind of tutor document, "proof of experience", for experienced
-- tutors and teachers (a link, a photo or a document). Kept as its own tiny migration because Postgres will not
-- let a new enum value be used in the same transaction that adds it. Purely additive; nothing else changes.
alter type public.doc_type add value if not exists 'proof_of_experience';
