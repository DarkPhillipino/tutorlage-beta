import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Shared set-up for the browser checks. Two jobs:
//  1. Hermetic network: every request to the database host (*.supabase.co) and to the payments/rooms API (*.workers.dev) is answered here, so
//     no test touches the dev or the production database. Default answers: tables are empty lists, auth answers an empty object. A test may
//     register its own answer for a request with page.route(...); the newest registration wins.
//  2. Problem collector: console errors, uncaught page errors, Content-Security-Policy violations and failed requests are recorded for each
//     test, so a test can say "nothing went wrong while this page loaded".

export interface Problems {
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: string[];
  failedRequests: string[];
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

export function databaseOrigin(): string {
  let url = process.env.VITE_SUPABASE_URL ?? '';
  if (!url) {
    try {
      url = /VITE_SUPABASE_URL="?([^"\r\n]+)"?/.exec(readFileSync('.env', 'utf8'))?.[1] ?? '';
    } catch {
      // no .env: the default below is only used to name the storage key
    }
  }
  return url || 'https://example-project.supabase.co';
}

async function answerBackend(context: BrowserContext) {
  await context.route(/\.(supabase\.co|workers\.dev)\//, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (request.url().includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{}' });
  });
}

export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page, context }, use) => {
      const problems: Problems = { consoleErrors: [], pageErrors: [], cspViolations: [], failedRequests: [] };
      await answerBackend(context);
      await page.addInitScript(() => {
        (window as unknown as { __csp: string[] }).__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      page.on('console', (m) => {
        if (m.type() === 'error') problems.consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => problems.pageErrors.push(String(e)));
      page.on('requestfailed', (r) => problems.failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));
      await use(problems);
    },
    { auto: true },
  ],
});

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

// A signed-in browser without a real sign-in: a made-up session (never accepted by any server) in the place supabase-js keeps one, with an
// expiry far in the future so the client uses it without asking anyone. Every database call is answered by the tests.
export async function signInFake(page: Page): Promise<void> {
  const ref = new URL(databaseOrigin()).hostname.split('.')[0];
  const base64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'browser-test@example.invalid', app_metadata: {}, user_metadata: { role: 'student' }, created_at: '2026-01-01T00:00:00Z' };
  const session = { access_token: `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: user.id, exp, role: 'authenticated' })}.x`, refresh_token: 'not-a-real-token', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${ref}-auth-token`, JSON.stringify(session)] as const);
}

export { expect };
