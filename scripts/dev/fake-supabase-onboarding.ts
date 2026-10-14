// A pretend Supabase for looking at the tutor's second and third sign-up pages (master 7cx) in a browser, with no real
// account and no contact with dev or production. It answers sign-in, the profile, the first-sign-in checks, the
// tutor_onboarding table and its two functions, the documents table and the private file store, with the same shapes
// the real service uses, so the real app (and supabase-js) run unchanged against it. Everything else answers "nothing".
// Used by scripts/dev/onboarding-preview.ts (the whole preview) and scripts/dev/onboarding-wiring-test.ts.
//
// Sign in with password "goodpassword1" and one of:
//   new.tutor@example.com    a tutor who signed up just now: no kind chosen yet (sees both pages)
//   old.tutor@example.com    a tutor from before the feature (grandfathered: never asked)
//   half.tutor@example.com   experienced, agreed, an approved ID and a police certificate that is too old
//   done.tutor@example.com   everything in and agreed (goes straight to the app)
//   admin@example.com        the admin app's one account (super admin); it also answers the admin's queue and detail queries
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeSupabase {
  url: string;
  log: { method: string; path: string; query: string; body: string }[];
  close: () => Promise<void>;
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

interface Doc {
  id: string;
  tutor_id: string;
  document_type: string;
  document_url: string;
  status: string;
  admin_notes: string | null;
  issued_on: string | null;
  uploaded_at: string;
}
interface Account {
  id: string;
  email: string;
  name: string;
  onboarding: { track: string | null; grandfathered: boolean; consented_at: string | null; consent_version: string | null } | null;
  docs: Doc[];
  isAdmin?: boolean;
  isVerified?: boolean;
}

const monthsAgo = (months: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};
const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

function freshAccounts(): Record<string, Account> {
  const doc = (tutor: string, n: number, type: string, status: string, issued: string | null, url?: string, notes: string | null = null): Doc => ({
    id: `${tutor}-doc-${n}`,
    tutor_id: tutor,
    document_type: type,
    document_url: url ?? `${tutor}/file-${n}.jpg`,
    status,
    admin_notes: notes,
    issued_on: issued,
    uploaded_at: new Date(Date.now() - n * 3600_000).toISOString(),
  });
  return {
    // For the admin app (scripts/dev/onboarding-preview.ts admin): the one admin account.
    'admin@example.com': { id: 'admin-1', email: 'admin@example.com', name: 'Ada Admin', onboarding: null, docs: [], isAdmin: true },
    'new.tutor@example.com': { id: 'tutor-new', email: 'new.tutor@example.com', name: 'Nomsa Tester', onboarding: null, docs: [] },
    'old.tutor@example.com': {
      id: 'tutor-old',
      email: 'old.tutor@example.com',
      name: 'Oswald Tester',
      onboarding: { track: null, grandfathered: true, consented_at: null, consent_version: null },
      docs: [],
    },
    'half.tutor@example.com': {
      id: 'tutor-half',
      email: 'half.tutor@example.com',
      name: 'Hlengiwe Tester',
      onboarding: { track: 'experienced', grandfathered: false, consented_at: new Date().toISOString(), consent_version: '2026-10-13-draft' },
      docs: [
        doc('tutor-half', 1, 'identity_doc', 'verified', null),
        doc('tutor-half', 2, 'police_clearance', 'pending', monthsAgo(7)),
        doc('tutor-half', 3, 'proof_of_experience', 'rejected', null, 'https://www.example-school.co.za/staff/hlengiwe', 'This page does not show your name.'),
      ],
    },
    'done.tutor@example.com': {
      id: 'tutor-done',
      email: 'done.tutor@example.com',
      name: 'Dineo Tester',
      onboarding: { track: 'beginner', grandfathered: false, consented_at: new Date().toISOString(), consent_version: '2026-10-13-draft' },
      docs: [
        doc('tutor-done', 1, 'identity_doc', 'pending', null),
        doc('tutor-done', 2, 'subject_results', 'pending', null),
        doc('tutor-done', 3, 'police_clearance', 'pending', daysAgo(30)),
      ],
    },
  };
}

export async function startFakeSupabase(port = 0): Promise<FakeSupabase> {
  const accounts = freshAccounts();
  const byId = () => Object.fromEntries(Object.values(accounts).map((a) => [a.id, a]));
  const log: FakeSupabase['log'] = [];
  let counter = 100;

  const tokenFor = (a: Account) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: a.id, email: a.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', session_id: `s-${a.id}` })}.fake`;
  const accountFromToken = (authorization: string | undefined): Account | null => {
    const token = (authorization ?? '').replace(/^Bearer /, '');
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return byId()[payload.sub] ?? null;
    } catch {
      return null;
    }
  };
  const userJson = (a: Account) => ({
    id: a.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: a.email,
    email_confirmed_at: '2026-10-10T08:00:00Z',
    app_metadata: { provider: 'email' },
    user_metadata: { role: 'tutor', first_name: a.name.split(' ')[0] },
    created_at: '2026-10-10T08:00:00Z',
  });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const cors = {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-headers': String(req.headers['access-control-request-headers'] ?? 'authorization, apikey, content-type'),
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
        'access-control-expose-headers': 'content-range',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      log.push({ method: req.method ?? '', path: url.pathname, query: url.search, body: url.pathname.startsWith('/storage/') ? '(file)' : rawBody });
      const send = (status: number, json?: unknown, extra: Record<string, string> = {}) => {
        res.writeHead(status, { ...cors, ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...extra });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      let body: Record<string, any> = {};
      try {
        body = rawBody && !url.pathname.startsWith('/storage/') ? JSON.parse(rawBody) : {};
      } catch {
        body = {};
      }
      const p = url.pathname;
      const me = accountFromToken(req.headers.authorization);
      const eq = (name: string) => decodeURIComponent(url.search.match(new RegExp(`[?&]${name}=eq\\.([^&]+)`))?.[1] ?? '');
      const wantsRows = /return=representation/.test(String(req.headers['prefer'] ?? ''));

      // ---- Auth ----
      if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const account = accounts[String(body.email ?? '').toLowerCase()];
        if (!account || body.password !== 'goodpassword1') return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(200, {
          access_token: tokenFor(account),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `refresh-${account.id}`,
          user: userJson(account),
        });
      }
      if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const account = Object.values(accounts).find((a) => `refresh-${a.id}` === body.refresh_token);
        if (!account) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return send(200, { access_token: tokenFor(account), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${account.id}`, user: userJson(account) });
      }
      if (p === '/auth/v1/signup') return send(200, { ...userJson(accounts['new.tutor@example.com']), email: String(body.email ?? ''), email_confirmed_at: null });
      if (p === '/auth/v1/user') return me ? send(200, userJson(me)) : send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      if (p === '/auth/v1/logout') return send(204);
      if (p.startsWith('/auth/v1/')) return send(200, {});

      // ---- the signed-in person's own rows ----
      if (p === '/rest/v1/profiles' && req.method === 'GET') {
        const a = byId()[eq('id')];
        return send(200, a ? [{ id: a.id, full_name: a.name, role: 'tutor', avatar_url: null }] : []);
      }
      if (p === '/rest/v1/rpc/my_date_of_birth') return send(200, '1999-05-05');
      if (p === '/rest/v1/rpc/my_pending_acceptances') return send(200, []);
      if (p === '/rest/v1/rpc/current_policy_versions') return send(200, [{ terms_version: 'fake', privacy_version: 'fake' }]);
      // One row shape that serves both the tutor's Teach screen and the admin's queue and detail page.
      const tutorRow = (a: Account) => ({
        id: a.id, headline: `${a.name.split(' ')[0]} - Tutor`, hourly_rate: 50, currency_code: 'ZAR', is_verified: a.isVerified ?? false,
        onboarding_status: a.isVerified ? 'verified' : 'pending_academic', avg_rating: null, total_reviews_count: 0, total_completed_hours: 0,
        total_sessions_completed: 0, teaching_mode: 'online', is_dispatch_active: false, current_sub_tier_id: '1A',
        repeat_student_rate_pct: 0, avg_grade_uplift_pct: 0, qualified_uplift_students_count: 0, institution_id: null, created_at: '2026-10-13T08:00:00Z',
        profiles: { full_name: a.name, avatar_url: null },
        tutor_subject_competencies: [{ subject_name: 'Mathematics', curriculum: 'caps', min_grade_level: 'Grade 8', max_grade_level: 'Grade 12', verification_status: 'verified' }],
        tutor_verification_documents: a.docs.map((d) => ({ id: d.id, tutor_id: d.tutor_id, document_type: d.document_type, document_url: d.document_url, status: d.status, admin_notes: d.admin_notes, uploaded_at: d.uploaded_at, reviewed_at: null })),
        tier_definitions: null, schools_institutions: null,
      });
      if (p === '/rest/v1/tutor_profiles' && req.method === 'GET') {
        if (url.search.includes('id=eq.')) {
          const a = byId()[eq('id')];
          return send(200, a && !a.isAdmin ? [tutorRow(a)] : []);
        }
        return send(200, Object.values(accounts).filter((a) => !a.isAdmin).map(tutorRow));
      }
      if (p === '/rest/v1/tutor_profiles' && req.method === 'PATCH') {
        const a = byId()[eq('id')];
        if (!a) return send(200, []);
        if (body.is_verified !== undefined) a.isVerified = body.is_verified;
        return send(200, wantsRows ? [{ id: a.id }] : undefined);
      }
      // ---- the admin app ----
      if (p === '/rest/v1/admin_profiles' && req.method === 'GET') {
        const a = byId()[eq('id')];
        return send(200, a?.isAdmin ? [{ id: a.id, first_name: 'Ada', surname: 'Admin', email: a.email, admin_role: 'super_admin', is_active: true }] : []);
      }
      if (p === '/rest/v1/rpc/admin_profile_private') {
        const ids: string[] = body.p_ids ?? [];
        return send(200, ids.map((id) => ({ id, email: byId()[id]?.email ?? null, phone_number: '000 000 0001', date_of_birth: '1999-05-05' })));
      }
      if ((p === '/rest/v1/tutor_verification_audits' || p === '/rest/v1/admin_audit_logs') && req.method === 'POST') return send(201);
      if (p === '/rest/v1/tutor_verification_documents' && req.method === 'PATCH') {
        const doc = Object.values(accounts).flatMap((a) => a.docs).find((d) => d.id === eq('id'));
        if (doc) {
          if (body.status) doc.status = body.status;
          if ('admin_notes' in body) doc.admin_notes = body.admin_notes;
        }
        return send(204);
      }

      // ---- the new tables ----
      if (p === '/rest/v1/tutor_onboarding' && req.method === 'GET') {
        const tutorIdFilter = url.searchParams.get('tutor_id') ?? '';
        const inList = tutorIdFilter.startsWith('in.(') ? tutorIdFilter.slice(4, -1) : undefined;
        if (inList !== undefined) {
          // The admin queue asks for many tutors at once.
          return send(200, inList.split(',').map((id) => decodeURIComponent(id).replace(/"/g, '')).flatMap((id) => (byId()[id]?.onboarding ? [{ tutor_id: id, ...byId()[id].onboarding }] : [])));
        }
        const a = byId()[eq('tutor_id')];
        return send(200, a?.onboarding ? [a.onboarding] : []);
      }
      if (p === '/rest/v1/rpc/set_my_tutor_track') {
        if (!me) return send(401, { message: 'Sign in first', code: '42501' });
        if (!['beginner', 'experienced'].includes(body.p_track)) return send(400, { message: 'Choose beginner or experienced', code: '22023' });
        me.onboarding = { grandfathered: false, consented_at: null, consent_version: null, ...(me.onboarding ?? {}), track: body.p_track };
        return send(204);
      }
      if (p === '/rest/v1/rpc/record_my_documents_consent') {
        if (!me?.onboarding?.track) return send(400, { message: 'Choose your tutor type first', code: '55000' });
        me.onboarding = { ...me.onboarding, consented_at: new Date().toISOString(), consent_version: body.p_version };
        return send(204);
      }
      if (p === '/rest/v1/tutor_verification_documents') {
        if (req.method === 'GET') return send(200, (byId()[eq('tutor_id')]?.docs ?? []).slice().sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)));
        if (req.method === 'POST') {
          if (!me || body.tutor_id !== me.id) return send(403, { message: 'new row violates row-level security policy for table "tutor_verification_documents"', code: '42501' });
          counter += 1;
          const doc: Doc = { id: `doc-${counter}`, status: 'pending', admin_notes: null, issued_on: null, uploaded_at: new Date().toISOString(), tutor_id: me.id, document_type: body.document_type, document_url: body.document_url, ...(body.issued_on ? { issued_on: body.issued_on } : {}) };
          me.docs.push(doc);
          return send(201, wantsRows ? [{ id: doc.id }] : undefined);
        }
        if (req.method === 'DELETE') {
          const doc = me?.docs.find((d) => d.id === eq('id'));
          if (!me || !doc || doc.status === 'verified') return send(200, []); // the row-level rule: a verified document stays
          me.docs = me.docs.filter((d) => d.id !== doc.id);
          return send(200, wantsRows ? [{ id: doc.id }] : undefined);
        }
      }
      // ---- the private file store ----
      if (req.method === 'POST' && p.startsWith('/storage/v1/object/tutor-documents/')) return send(200, { Key: p.replace('/storage/v1/object/', ''), Id: 'fake' });
      if (req.method === 'DELETE' && p === '/storage/v1/object/tutor-documents') return send(200, []);

      // ---- everything else the app asks for on start-up: nothing there ----
      if (req.method === 'HEAD') return send(200, undefined, { 'content-range': '*/0' });
      if (req.method === 'GET') return send(200, []);
      return send(200, null);
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: bound } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${bound}`, log, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
