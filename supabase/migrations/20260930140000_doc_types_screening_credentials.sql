-- Backlog 7h/7f (2026-09-30): the CEO's screening decision needs tutors to upload clearance
-- documents, and the credential route needs qualification and marking evidence. The doc_type enum
-- only had identity/matric/transcript/police/address. Added in its own migration because a new enum
-- value can't be used in the same transaction that adds it.
alter type public.doc_type add value if not exists 'nrso_clearance';
alter type public.doc_type add value if not exists 'child_protection_register_clearance';
alter type public.doc_type add value if not exists 'teaching_qualification';
alter type public.doc_type add value if not exists 'sace_certificate';
alter type public.doc_type add value if not exists 'practicum_letter';
alter type public.doc_type add value if not exists 'marking_appointment_letter';
alter type public.doc_type add value if not exists 'subject_results';
