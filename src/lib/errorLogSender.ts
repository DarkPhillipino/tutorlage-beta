// The database half of error tracking (release gate OPS-ERRORS-01): one call to log_client_error (migration 20261020160000).
// Handed to src/lib/errorLog.ts from src/main.tsx. Signed-in and signed-out visitors both use it; the database reads whether the
// person was signed in from their sign-in, so nothing about the person is sent. The "fail silently, stop after the first refusal"
// behaviour lives in createRpcSender (errorLog.ts) so it can be tested without a database.
import { supabase } from './supabaseClient';
import { createRpcSender } from './errorLog';

export const sendClientError = createRpcSender((fn, args) => supabase.rpc(fn, args));
