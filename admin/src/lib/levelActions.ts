import type { CredentialConfig, LevelConfig, TierConfig } from '../types';

// What the Levels screen can do. The page passes the real ones (lib/levelQueries.ts, which call the admin-only database functions);
// a test passes pretend ones. This file has no Supabase code on purpose, so the screen can be rendered without a database.
export interface LevelActions {
  saveTier: (tier: Omit<TierConfig, 'currencyCode'>) => Promise<void>;
  saveLevel: (level: LevelConfig) => Promise<void>;
  saveCredentialDefinition: (credential: Omit<CredentialConfig, 'heldBy'>) => Promise<void>;
  deleteCredentialDefinition: (code: string) => Promise<void>;
  recalculateAllLevels: () => Promise<number>;
}

// What the Level section of a tutor's page can do.
export interface TutorLevelActions {
  assignTutorLevel: (tutorId: string, level: string, reason: string) => Promise<void>;
  clearTutorAssignedLevel: (tutorId: string, reason: string) => Promise<void>;
  recordTutorCredential: (tutorId: string, code: string, obtainedOn: string | null, documentId: string | null, note: string) => Promise<void>;
  removeTutorCredential: (id: string, reason: string) => Promise<void>;
}
