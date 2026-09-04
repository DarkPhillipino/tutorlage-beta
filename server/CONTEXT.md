Last updated: 2026-08-30

# Backend / AI integration workspace

## Scope

The Express server, Gemini (`@google/genai`) integration, and privileged (service-role) Supabase access. Not built yet — this file establishes where that work should live once it starts, so it doesn't sprawl into `src/` or the repo root.

Evidence this is planned but unbuilt:

- `package.json` already depends on `express`, `dotenv`, `@google/genai`, and its `clean` script expects a generated `server.js` at the repo root.
- `.env.example` defines `GEMINI_API_KEY`, `APP_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- `metadata.json` flags `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`.

Note on Supabase specifically: the database itself is already connected and in use — from `src/` (see `src/CONTEXT.md`), via the publishable key, RLS-enforced. What's *not* built yet is this workspace's service-role connection, needed only for operations that must bypass RLS (admin actions, payouts, cross-user moderation). Don't build a Supabase client here until there's an actual privileged operation that needs one.

## Process

- Server code goes under `server/` (e.g. `server/index.ts`), not the repo root and not `src/`.
- Read secrets via `dotenv`/`process.env` only — never hardcode `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, and never commit real values (only `.env.example` with placeholders is committed).
- The frontend should call this server's endpoints; it should never call the Gemini API directly from the browser (that would expose the API key). Supabase is different — the frontend already talks to Supabase directly using the publishable key, and that's fine because RLS enforces access. Only route a Supabase operation through here if it specifically needs to bypass RLS.
- Match the TypeScript conventions already used in `src/` (typed request/response shapes, no `any`).

## What good work looks like

- API keys stay server-side only.
- Small, focused endpoints (one job each) rather than one large catch-all handler.
- New shared types for request/response shapes get added near the endpoint that uses them, or promoted to `src/types.ts` if the frontend needs them too.

## Out of scope

React components, Tailwind styling, mock data shape decisions for the UI — that's the frontend workspace (`src/CONTEXT.md`).

## Skills

None wired in yet. If a backend-specific skill gets added later (e.g. an API-testing skill or a Gemini/prompting skill), list it here — this workspace should only load skills relevant to server/API work, not frontend skills.
