// Starts the real app (Vite) pointed at a pretend Supabase (scripts/dev/fake-supabase-onboarding.ts), with the tutor's
// second and third sign-up pages switched on, so they can be clicked through with no real account. Nothing touches dev
// or production. The pretend backend is on port 54420.
//   npx tsx scripts/dev/onboarding-preview.ts          the tutor's pages: http://127.0.0.1:3098/signin/tutor
//   npx tsx scripts/dev/onboarding-preview.ts admin    the admin app (reviewer's side): http://127.0.0.1:3097/login
// Sign in with password goodpassword1 and: new.tutor@example.com, old.tutor@example.com, half.tutor@example.com or
// done.tutor@example.com (tutor app), or admin@example.com (admin app). See fake-supabase-onboarding.ts.
import path from 'node:path';
import { createServer } from 'vite';
import { startFakeSupabase } from './fake-supabase-onboarding';

const adminMode = process.argv.includes('admin');
const fake = await startFakeSupabase(54420);
// Variables already in the environment win over .env, so the real dev keys in .env are never used.
process.env.VITE_SUPABASE_URL = fake.url;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'fake-publishable-key';
process.env.VITE_TUTOR_ONBOARDING = '1';
process.env.VITE_API_BASE_URL = fake.url;

const vite = await createServer(
  adminMode
    ? { root: path.resolve('admin'), server: { port: 3097, strictPort: true, host: '127.0.0.1' } }
    : { server: { port: 3098, strictPort: true, host: '127.0.0.1' } },
);
await vite.listen();
console.log(`Pretend backend on ${fake.url}; ${adminMode ? 'admin app on http://127.0.0.1:3097/login' : 'app on http://127.0.0.1:3098/signin/tutor'} (password goodpassword1)`);
