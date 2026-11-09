-- PROPOSED, NOT TO BE APPLIED WITHOUT A DECISION: stop signed-out visitors calling three SECURITY DEFINER functions that only signed-in screens use
-- (P2 security review, 4 Nov 2026). Written so the security advisor's list of "SECURITY DEFINER functions callable by the anon role" goes from
-- seven to four, all four being ones a signed-out visitor really needs. The full reasoning, function by function, is in
-- Drake/programmer/reports/2026-11-04-p2-security.md (section 4).
--
-- The seven functions the advisor lists, and what this file does with each:
--   KEPT public (a signed-out screen or a documented decision needs them):
--     current_policy_versions()   the sign-up page reads the current Terms / Privacy version before the account exists
--     log_client_error(...)       error reports from signed-out screens (sign-in, sign-up); scrubbed, rate-limited, capped
--     public_tutor_reviews(uuid)  a tutor's public reviews (verified tutors only, four columns, 200 rows); a decision of the 21 Oct review
--     free_sessions_open()        "anyone may ask" by design (migration 20261102100000, test F2/F6): one yes/no, the launch mode
--   CLOSED to anon by this file (execute stays with signed-in users; nothing a signed-out screen calls):
--     available_price_levels(text, text, uuid, timestamptz, numeric, uuid)
--         only the signed-in booking screens (PricesPage, LevelSelectionPage) call it. It is the heaviest of the seven (a calendar and
--         qualification check per tutor), so anyone holding the public key could run it in a loop, and it tells a stranger how many tutors
--         are free for a subject, grade and hour.
--     school_curricula(uuid)
--         only the signed-in booking form calls it. It returns only what the public schools table shows, so the risk is small: tidying.
--     wallet_open()
--         only signed-in wallet and booking screens call it. One yes/no, the risk is small: tidying.
--
-- WHAT THIS MIGRATION CHANGES (it replaces no function body and drops nothing; only who may run three functions):
--   REVOKE ALL ... FROM public, anon   on  available_price_levels(text, text, uuid, timestamptz, numeric, uuid), school_curricula(uuid), wallet_open()
--   GRANT EXECUTE ... TO authenticated on the same three (it already has it; repeated so the end state is explicit)
-- Untouched: the four functions kept public, every other function, service_role's own rights, every table and policy.
-- The app already treats a failed call to wallet_open() / school_curricula / available_price_levels as "no" or "empty" (src/lib/wallet.ts,
-- priceLevelCall.ts, readTimeout.ts), and no signed-out screen calls them (checked in src/ on 4 Nov 2026), so nothing visible changes.
-- If the CEO would rather keep the two small ones as they are, delete their lines before applying; the first one is the one that matters.

revoke all on function public.available_price_levels(text, text, uuid, timestamptz, numeric, uuid) from public, anon;
grant execute on function public.available_price_levels(text, text, uuid, timestamptz, numeric, uuid) to authenticated;

revoke all on function public.school_curricula(uuid) from public, anon;
grant execute on function public.school_curricula(uuid) to authenticated;

revoke all on function public.wallet_open() from public, anon;
grant execute on function public.wallet_open() to authenticated;
