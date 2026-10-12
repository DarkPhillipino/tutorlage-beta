// Starts the pretend Auth server (scripts/dev/fake-auth.ts) on a fixed local port, so the running app can be pointed at
// it to look at the sign-in, "send the link again", "forgot password" and "set a new password" screens with no real
// email and no contact with dev or production:
//
//   npx tsx scripts/dev/fake-auth-server.ts                # PORT=54399 by default
//   VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_PUBLISHABLE_KEY=fake npx vite --port 3099
//
// Environment variables already set in the shell win over .env, so the real dev keys in .env are not used.
// Addresses that start "unconfirmed", "toosoon", "window41", "sitecap", "smtpfail" and "down503" give the matching failures (see fake-auth.ts).
// A reset link that works against it: /reset-password#access_token=<token printed below>&refresh_token=x&expires_in=3600&token_type=bearer&type=recovery
import { fakeAccessToken, startFakeAuth } from './fake-auth';

const port = Number(process.env.PORT ?? 54399);

startFakeAuth(port).then((fake) => {
  console.log(`Pretend Auth server on ${fake.url} (sends nothing, stores nothing). Ctrl+C to stop.`);
  console.log(`Reset-link token (valid for an hour): ${fakeAccessToken('tester@example.com', 3600)}`);
});
