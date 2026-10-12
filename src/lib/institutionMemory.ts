import type { Institution } from '../types';

// Master 7cq. A guardian can read a linked learner's profile but not change it, so the institution they pick
// when booking for a learner can't be saved on the learner's row. It is remembered here instead, per guardian and
// learner, in this browser only (clearing site data, or another device, starts blank). A learner's own
// institution is saved on their profile (queries.ts, updateStudentInstitution) and never comes through here.

const storageKey = (guardianId: string, learnerId: string) => `tutorlage.institution.${guardianId}.${learnerId}`;

export function rememberInstitution(guardianId: string, learnerId: string, institution: Institution): void {
  try {
    window.localStorage.setItem(storageKey(guardianId, learnerId), JSON.stringify(institution));
  } catch {
    // Storage blocked or full (private window, "block site data"): the choice simply isn't remembered.
  }
}

export function recallInstitution(guardianId: string, learnerId: string): Institution | null {
  try {
    const raw = window.localStorage.getItem(storageKey(guardianId, learnerId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Institution> | null;
    if (value && typeof value.id === 'string' && typeof value.name === 'string' && value.id && value.name) {
      return {
        id: value.id,
        name: value.name,
        curriculum: typeof value.curriculum === 'string' ? value.curriculum : 'Other',
        institutionType: typeof value.institutionType === 'string' ? value.institutionType : '',
      };
    }
  } catch {
    // Unreadable or hand-edited: treat as nothing remembered.
  }
  return null;
}
