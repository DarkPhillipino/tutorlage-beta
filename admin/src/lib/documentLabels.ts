import type { DocumentType } from '../types';

// What an admin calls each kind of document a tutor can send.
export const DOC_LABELS: Record<DocumentType, string> = {
  identity_doc: 'Identity Document',
  matric_certificate: 'Matric Certificate',
  university_transcript: 'University Transcript',
  police_clearance: 'Police Clearance',
  proof_of_address: 'Proof of Address',
  nrso_clearance: 'Sex Offenders Register Clearance (NRSO)',
  child_protection_register_clearance: 'Child Protection Register Clearance',
  teaching_qualification: 'Teaching Qualification',
  sace_certificate: 'SACE Registration',
  practicum_letter: 'Teaching Practicum Letter',
  marking_appointment_letter: 'Exam Marking / Moderation Appointment',
  subject_results: 'Subject Results',
  proof_of_experience: 'Proof of Experience',
};
