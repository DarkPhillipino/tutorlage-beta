// Error tracking, the app's half (release gate OPS-ERRORS-01, 20 Oct 2026; the CEO chose "our own table + an admin page").
// A crash used to be written only to the visitor's own browser console. This hands a cleaned-up report to a "sender" (src/lib/
// errorLogSender.ts: one call to the database function log_client_error, migration 20261020160000), at most a few per page load.
//
// Rules this file keeps:
//  - It NEVER throws and never blocks: every path is wrapped, the sender is called without waiting, and a failing sender is ignored.
//  - It fails silently when the database half is not there yet (the published site reads the dev database, which may not have the
//    migration): the sender stops trying after its first refusal.
//  - It keeps NO personal data: emails, sign-in tokens, long token-like strings, ids, phone or ID numbers and the query part of web
//    addresses are removed here, and the database removes them again. The screen is the address path with ids and the /room/ code
//    masked, plus the app's own name for the view (setErrorScreen), because most of the app is one address.
//  - It has no dependency on Supabase, auth or translation (it must work when one of them is what broke), so the sender is handed
//    in from src/main.tsx and this file also runs under Node for scripts/dev/error-log-test.ts.
// The same cleaning rules are written in SQL in the migration (scrub_client_error_text / scrub_client_error_screen).

import { getErrorMessage } from './errors';

export type ErrorKind = 'render' | 'unhandled' | 'rejection' | 'logged';

export interface ErrorReport {
  kind: ErrorKind;
  message: string;
  screen: string;
  details: string | null;
  browser: string | null;
}

export type ErrorSender = (report: ErrorReport) => unknown;

// Per page load: one report per distinct error, and no more than this many in all (a crash loop must not become a request storm).
export const MAX_REPORTS_PER_PAGE_LOAD = 5;
const MAX_MESSAGE = 300;
const MAX_DETAILS = 1500;
const MAX_SCREEN = 120;
const STACK_LINES = 6;

let sender: ErrorSender | null = null;
let sentCount = 0;
const seen = new Set<string>();
let screenLabel: string | null = null;

export function setErrorSender(next: ErrorSender | null): void {
  sender = next;
}

// The app's own name for the view being shown ("prices", "sessions" ...). Cleared with null.
export function setErrorScreen(label: string | null): void {
  screenLabel = label ? label.slice(0, 40) : null;
}

export function resetErrorLogForTests(): void {
  sender = null;
  sentCount = 0;
  seen.clear();
  screenLabel = null;
}

// ---- cleaning ---------------------------------------------------------------------------------------------------------------
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export function scrubText(text: string, max: number): string {
  return text
    .slice(0, max * 4)
    .replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/g, '$1')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, '[token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(UUID, '[id]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
    .replace(/\+?[0-9][0-9\s().-]{7,}[0-9]/g, '[number]')
    .slice(0, max)
    .trim();
}

// The address path with anything that could identify a person or open a room removed.
export function maskScreenPath(path: string): string {
  const bare = path.slice(0, 500).split('?')[0].split('#')[0];
  const masked = bare
    .replace(/\/room\/\S+/g, '/room/:code')
    .replace(UUID, ':id')
    .replace(/\/[^/\s]*[0-9]{6}[^/\s]*/g, '/:id')
    .replace(/\/[^/\s]{25,}/g, '/:id');
  return scrubText(masked, MAX_SCREEN);
}

// A coarse "browser + system" label (no versions), enough to tell a phone from a laptop. Not an identifier.
export function describeBrowser(ua: string): string | null {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux'
    : 'other system';
  const browser = /FBAN|FBAV/i.test(ua) ? 'Facebook app'
    : /Instagram/i.test(ua) ? 'Instagram app'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'other browser';
  return `${browser} on ${os}`;
}

// ---- building a report -----------------------------------------------------------------------------------------------------
function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return { message: `${name}${error.message}` || 'Unknown error', stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  return { message: getErrorMessage(error, 'Unknown error'), stack: null };
}

function topLines(text: string | null | undefined, pattern: RegExp): string[] {
  if (!text) return [];
  return text.split('\n').filter((line) => pattern.test(line)).slice(0, STACK_LINES).map((line) => line.trim());
}

export function buildReport(
  error: unknown,
  kind: ErrorKind,
  extra: { componentStack?: string | null } = {},
  env: { pathname?: string; userAgent?: string } = {},
): ErrorReport {
  const { message, stack } = describeError(error);
  const pathname = env.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const userAgent = env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const screen = `${maskScreenPath(pathname || '/')}${screenLabel ? ` [${screenLabel}]` : ''}`.slice(0, MAX_SCREEN);

  const stackLines = topLines(stack, /^\s*at\s|@/);
  const componentLines = topLines(extra.componentStack, /\S/);
  const parts: string[] = [];
  if (stackLines.length) parts.push(stackLines.join('\n'));
  if (componentLines.length) parts.push(`Components:\n${componentLines.join('\n')}`);

  return {
    kind,
    message: scrubText(message, MAX_MESSAGE) || 'Unknown error',
    screen: screen || '/',
    details: parts.length ? scrubText(parts.join('\n'), MAX_DETAILS) || null : null,
    browser: scrubText(describeBrowser(userAgent) ?? '', 80) || null,
  };
}

// ---- the sender -----------------------------------------------------------------------------------------------------------------
export type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;

// Turns "call a database function" into a sender. Fails silently, on purpose: the published site reads the dev database, which may not
// have the migration yet, so the first refusal (function not found, no network, anything) switches sending off for the rest of this
// page load. A missing migration then costs one failed request, never a loop and never an error on screen.
export function createRpcSender(rpc: RpcCaller): (report: ErrorReport) => Promise<void> {
  let switchedOff = false;
  return async (report) => {
    if (switchedOff) return;
    try {
      const { error } = await rpc('log_client_error', {
        p_kind: report.kind,
        p_message: report.message,
        p_screen: report.screen,
        p_details: report.details,
        p_browser: report.browser,
      });
      if (error) switchedOff = true;
    } catch {
      switchedOff = true;
    }
  };
}

// ---- noise that is not a fault of ours ---------------------------------------------------------------------------------------
// Only applied to errors nobody caught (the global handlers), never to a screen that crashed.
export function isNoise(message: string): boolean {
  return (
    /^script error\.?$/i.test(message) ||
    /ResizeObserver loop/i.test(message) ||
    /^(TypeError: )?(failed to fetch|load failed|networkerror when attempting to fetch|network request failed)/i.test(message) ||
    /^AbortError/i.test(message)
  );
}

// ---- logging ---------------------------------------------------------------------------------------------------------------------
// Returns true when a report was handed to the sender. Never throws.
export function logClientError(
  error: unknown,
  kind: ErrorKind = 'logged',
  extra: { componentStack?: string | null } = {},
): boolean {
  try {
    if (!sender || sentCount >= MAX_REPORTS_PER_PAGE_LOAD) return false;
    const report = buildReport(error, kind, extra);
    if (kind !== 'render' && isNoise(report.message)) return false;
    const key = `${report.kind}|${report.message}|${report.screen}`;
    if (seen.has(key)) return false;
    seen.add(key);
    sentCount += 1;
    const result = sender(report);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

const EXTENSION_FILE = /^(chrome|moz|safari|safari-web)-extension:/i;

// Errors nobody caught: a failed click handler, a promise nobody waited for. Returns a function that removes the listeners.
export function installGlobalErrorLogging(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window !== 'undefined' ? window : null,
): () => void {
  if (!target) return () => undefined;
  const onError = (event: Event) => {
    try {
      const e = event as ErrorEvent;
      if (e.filename && EXTENSION_FILE.test(e.filename)) return;
      logClientError(e.error ?? e.message, 'unhandled');
    } catch {
      /* never throw from a handler */
    }
  };
  const onRejection = (event: Event) => {
    try {
      logClientError((event as PromiseRejectionEvent).reason, 'rejection');
    } catch {
      /* never throw from a handler */
    }
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
