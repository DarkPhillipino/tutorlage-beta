import { supabase } from './supabaseClient';
import { judgeRecoveryLink, parseAuthRedirect, type RecoveryLinkVerdict } from './authHelpers';

// A password-reset email link brings the person back with a short-lived session in the address fragment
// (#access_token=...&type=recovery). supabase-js reads it on start-up, stores the session and then clears the
// fragment, so by the time a page renders the address no longer says "this was a reset link". This file reads
// the address once, as soon as it is loaded (supabase-js clears the fragment only after a network call, so it is
// still there), and remembers the answer for the "set a new password" page.
//
// What the address says is only a CLAIM: anyone can type "#type=recovery&access_token=x" into the address bar, and
// supabase-js then keeps the signed-in person's own session and shrugs the junk off. So the claim never opens the
// "set a new password" form by itself. checkRecoveryLink() below asks supabase-js how it got on with the link
// (initialize(), which is null only when the server accepted the token), and only that answer, or the flag an earlier
// confirmed load of this tab left behind, counts (judgeRecoveryLink in authHelpers.ts holds the rule and is tested).
//
// The router is BrowserRouter (main.tsx), so the fragment is never used for routing and cannot collide with the
// tokens (a HashRouter would have).

const PENDING_KEY = 'tutorlage_password_recovery';

const landing =
  typeof window === 'undefined'
    ? { isRecovery: false, errorCode: null, errorDescription: null }
    : parseAuthRedirect(window.location.hash, window.location.search);

// The address of this page load CLAIMS to be a reset link. Not proof: see checkRecoveryLink().
export const arrivedWithRecoveryLink: boolean = landing.isRecovery;

// This page load came from a link that Supabase refused (expired or already used).
export const arrivedWithLinkError: boolean = landing.errorCode !== null;

// Set once the new password has been saved, so the same page load does not offer the form again.
let finished = false;
// The claim in the address was checked and the server did not stand behind it (a forged or dead address).
let disproved = false;

function setPending(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(PENDING_KEY, '1');
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: the answer of this page load still covers the first load.
  }
}

function flagSet(): boolean {
  try {
    return sessionStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

// A reset may be in progress in this tab and the new password has not been set yet: the address claims it, or an
// earlier load of this tab had it confirmed (the flag survives a reload, because the fragment is gone after the first
// load). Only a reason to look closer: checkRecoveryLink() gives the verdict. The flag is only ever written after
// the server has accepted a link (below), never from the address alone.
export function recoveryPending(): boolean {
  if (finished || disproved) return false;
  return arrivedWithRecoveryLink || flagSet();
}

// The verdict on this page load. 'confirmed' = a real reset link is being worked through here; 'could-not-check' =
// Supabase could not be reached to ask (nothing is known, and reloading may help); 'not-a-reset-link' = anything else.
export async function checkRecoveryLink(): Promise<RecoveryLinkVerdict> {
  if (finished) return 'not-a-reset-link';

  // initialize() hands back the result supabase-js already has for this page load: did it read the link, did Supabase
  // accept the token, is the session saved. It also waits for all of that to finish, so no caller moves the person
  // to another address before the tokens have been read.
  let initializeError: unknown = null;
  try {
    initializeError = (await supabase.auth.initialize()).error;
  } catch (caught) {
    initializeError = caught;
  }

  const verdict = judgeRecoveryLink(arrivedWithRecoveryLink, initializeError, flagSet());
  if (arrivedWithRecoveryLink) {
    if (verdict === 'confirmed') {
      disproved = false;
      setPending(true);
    } else if (verdict === 'not-a-reset-link') {
      disproved = true;
    }
  }
  return verdict;
}

// supabase-js said PASSWORD_RECOVERY (it only does after the server accepted the token): the link was good and its
// session is in place.
export function markRecoveryPending(): void {
  finished = false;
  disproved = false;
  setPending(true);
}

// The new password was saved (or the person left): the reset session is no longer a reset in progress.
export function clearRecoveryPending(): void {
  finished = true;
  setPending(false);
}
