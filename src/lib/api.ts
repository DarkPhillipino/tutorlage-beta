import { supabase } from './supabaseClient';

// Where server/index.ts lives. In development Vite forwards /api to the local
// server (vite.config.ts), so this is empty and calls stay on the app's own
// origin. A production build sets VITE_API_BASE_URL to the deployed server's
// address (master backlog item 1) — GitHub Pages has no /api of its own.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// The signed-in user's access token for server/index.ts, which takes identity
// from it — never from a request body.
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to continue.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
