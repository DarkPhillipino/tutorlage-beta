// A pretend Supabase Auth (GoTrue) server for testing the account-email screens (master 7cl, 7cm) without sending any
// real email or touching dev or production. It answers on a local port with the same JSON shapes and error codes the
// real service uses, so supabase-js builds the same error objects it would build against the real thing.
//
// Used by scripts/dev/auth-helpers-test.ts (in-process) and scripts/dev/fake-auth-server.ts (a port you can point the
// running app at). The address typed decides the answer:
//   unconfirmed*@  sign-in: 400 email_not_confirmed (right password, address not confirmed)
//   toosoon*@      resend / recover: 429 over_email_send_rate_limit ("... once every 60 seconds", the older wording)
//   window41*@     resend / recover: 429 over_email_send_rate_limit ("... after 41 seconds.", the newer wording)
//   sitecap*@      resend / recover: 429 over_email_send_rate_limit ("email rate limit exceeded", the whole-site cap)
//   smtpfail*@     resend / recover: 500 "Error sending ... email"
//   down503*@      resend / recover: 503 (the service is down)
//   anything else  sign-in with password "goodpassword1" works; resend / recover answer 200 and send nothing
// Passwords on "set a new password": "samepassword1" -> 422 same_password; under 8 characters -> 422 weak_password.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  authorization: string | null;
}

export interface FakeAuth {
  url: string;
  calls: FakeCall[];
  // When true, "set a new password" answers as if the reset session was already gone.
  revokeSessions: boolean;
  close: () => Promise<void>;
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// A token shaped like a real JWT (supabase-js reads its `exp`); the fake server accepts any token that starts "fake.".
export function fakeAccessToken(email = 'tester@example.com', expiresInSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'user-1', email, exp, role: 'authenticated', session_id: 'session-1' })}.fake`;
}

const user = (email: string) => ({
  id: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  email,
  email_confirmed_at: '2026-10-10T08:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-10-10T08:00:00Z',
});

export async function startFakeAuth(port = 0): Promise<FakeAuth> {
  const calls: FakeCall[] = [];
  const state = { revokeSessions: false };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const send = (status: number, body: unknown) => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'OPTIONS') return send(204, {});

      let body: Record<string, unknown> = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch {
        body = {};
      }
      const authorization = (req.headers.authorization as string | undefined) ?? null;
      const call: FakeCall = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
        authorization,
      };
      calls.push(call);

      const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
      const apiError = (status: number, code: string, msg: string, extra: object = {}) =>
        send(status, { code: status, error_code: code, msg, ...extra });

      // Sending an email (resend / recover): the same few outcomes for both.
      const mailOutcome = (what: string) => {
        if (email.startsWith('toosoon')) {
          return apiError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this once every 60 seconds');
        }
        // The same per-person window in the newer wording (it counts down what is left) and the whole-site cap.
        if (email.startsWith('window41')) {
          return apiError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 41 seconds.');
        }
        if (email.startsWith('sitecap')) return apiError(429, 'over_email_send_rate_limit', 'email rate limit exceeded');
        if (email.startsWith('smtpfail')) return apiError(500, 'unexpected_failure', `Error sending ${what} email`);
        if (email.startsWith('down503')) return send(503, { msg: 'Service Unavailable' });
        return send(200, {});
      };

      if (call.path === '/auth/v1/token' && call.query.grant_type === 'password') {
        if (email.startsWith('unconfirmed')) return apiError(400, 'email_not_confirmed', 'Email not confirmed');
        if (body.password !== 'goodpassword1') return apiError(400, 'invalid_credentials', 'Invalid login credentials');
        return send(200, {
          access_token: fakeAccessToken(email),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'fake-refresh',
          user: user(email),
        });
      }
      if (call.path === '/auth/v1/signup') {
        // Email confirmation on: the answer is the new user and no session.
        return send(200, { ...user(email), email_confirmed_at: null });
      }
      if (call.path === '/auth/v1/resend') return mailOutcome('confirmation');
      if (call.path === '/auth/v1/recover') return mailOutcome('recovery');
      if (call.path === '/auth/v1/user') {
        if (!authorization?.startsWith('Bearer fake.') && !authorization?.includes('.fake')) {
          return apiError(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature');
        }
        if (req.method === 'GET') return send(200, user('tester@example.com'));
        if (req.method === 'PUT') {
          if (state.revokeSessions) return apiError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
          const password = typeof body.password === 'string' ? body.password : '';
          if (password === 'samepassword1') {
            return apiError(422, 'same_password', 'New password should be different from the old password.');
          }
          if (password.length < 8) {
            return apiError(422, 'weak_password', 'Password should be at least 8 characters.', { weak_password: { reasons: ['length'] } });
          }
          return send(200, user('tester@example.com'));
        }
      }
      // Anything else (the app's own database reads, if a page is open against this server): nothing there.
      return send(404, { message: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: boundPort } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    calls,
    get revokeSessions() {
      return state.revokeSessions;
    },
    set revokeSessions(value: boolean) {
      state.revokeSessions = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
