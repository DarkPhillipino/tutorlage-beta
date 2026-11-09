// How the Tutor Verification queue is ordered at 50 to 100 tutors (burst-readiness, 4 Nov 2026). Pure on purpose (no Supabase, no React), so
// scripts/dev/verification-queue-test.ts can check every rule.
//
// Before: one list in sign-up order, every tutor who ever signed up (also the ones who never uploaded anything), a page to find the next one.
// Now: three groups, and inside the first one the tutor who has WAITED LONGEST for a decision comes first.
//   1. "Documents waiting for you": at least one document is pending or under review. Oldest waiting document first.
//   2. "Nothing to review yet": signed up, no document waiting (not finished uploading, or everything already decided). Sign-up order.
//   3. "Not approved": rejected. Sign-up order. (Approved tutors only show when "Show verified too" is ticked.)
// "Next tutor" after a decision is the first tutor of group 1 that is not the one just decided.
import type { TutorForVerification } from '../types';

export type QueueGroup = 'to_review' | 'nothing_yet' | 'rejected' | 'verified';

export const GROUP_TITLES: Record<QueueGroup, string> = {
  to_review: 'Documents waiting for you',
  nothing_yet: 'Nothing to review yet',
  rejected: 'Not approved',
  verified: 'Verified',
};
export const GROUP_ORDER: QueueGroup[] = ['to_review', 'nothing_yet', 'rejected', 'verified'];

// tutor id -> when their OLDEST pending or under-review document was uploaded (ISO). A tutor missing from the map falls back to sign-up time.
export type WaitingSince = ReadonlyMap<string, string>;

export function groupOf(t: Pick<TutorForVerification, 'onboardingStatus' | 'pendingDocumentCount'>): QueueGroup {
  if (t.onboardingStatus === 'verified') return 'verified';
  if (t.onboardingStatus === 'rejected') return 'rejected';
  return t.pendingDocumentCount > 0 ? 'to_review' : 'nothing_yet';
}

const time = (iso: string | null | undefined): number => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

// The moment a tutor started waiting: the oldest waiting document, else the sign-up time.
export function waitingFrom(t: Pick<TutorForVerification, 'id' | 'createdAt'>, since: WaitingSince): string {
  return since.get(t.id) ?? t.createdAt;
}

export function sortQueue(tutors: TutorForVerification[], since: WaitingSince): TutorForVerification[] {
  const rank = (t: TutorForVerification) => GROUP_ORDER.indexOf(groupOf(t));
  return [...tutors].sort((a, b) => {
    const byGroup = rank(a) - rank(b);
    if (byGroup !== 0) return byGroup;
    const key = (t: TutorForVerification) => time(groupOf(t) === 'to_review' ? waitingFrom(t, since) : t.createdAt);
    return key(a) - key(b) || a.name.localeCompare(b.name);
  });
}

export interface QueueSection { group: QueueGroup; title: string; tutors: TutorForVerification[] }

// The groups to draw, in order; an empty group is left out. `showVerified` false hides approved tutors.
export function buildSections(tutors: TutorForVerification[], since: WaitingSince, opts: { search?: string; showVerified?: boolean } = {}): QueueSection[] {
  const query = (opts.search ?? '').trim().toLowerCase();
  const kept = sortQueue(tutors, since).filter((t) => (opts.showVerified || groupOf(t) !== 'verified') && matchesSearch(t, query));
  return GROUP_ORDER.map((group) => ({ group, title: GROUP_TITLES[group], tutors: kept.filter((t) => groupOf(t) === group) })).filter((s) => s.tutors.length > 0);
}

// Name, email or headline contains every word typed (case does not matter). An empty search matches everyone.
export function matchesSearch(t: Pick<TutorForVerification, 'name' | 'email' | 'headline'>, rawQuery: string): boolean {
  const words = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${t.name} ${t.email} ${t.headline ?? ''}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

// The tutor to open after a decision on `currentId`: the longest-waiting tutor with a document waiting, never the one just decided.
// Null when nobody else is waiting (the page then goes back to the list).
export function nextToReview(tutors: TutorForVerification[], since: WaitingSince, currentId: string): TutorForVerification | null {
  return sortQueue(tutors, since).find((t) => t.id !== currentId && groupOf(t) === 'to_review') ?? null;
}

// "waiting 3 days", "waiting 5 hours", "waiting under an hour" (a person decides how urgent it is by this).
export function waitingText(fromIso: string, nowMs: number): string {
  const ms = nowMs - time(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return 'waiting under an hour';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'waiting under an hour';
  if (hours < 48) return `waiting ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `waiting ${days} days`;
}
