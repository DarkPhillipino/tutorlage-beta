# Concurrent claim race (two tutors, one request)

**Dev database only (`wfpjoxetbprmllqqarwp`). Never production.** The runner refuses to start unless the copy is linked to dev.

Every other suite in `supabase/tests` runs inside one rolled-back transaction, which cannot test a race (one transaction is one connection). This one keeps its rows
(made-up people, `example.invalid`, names starting Zzrace) so two real connections can see them, and removes them afterwards.

What it does (`claim-race.mjs`): `cleanup.sql`, then `setup.sql` (a learner with R1000 in the wallet, two verified tutors who may both take every request, six R100 wallet
requests already sent and held), then 12 separate `supabase db query` processes, two per request, one per tutor. Each process sleeps inside the database until one shared
instant and then calls `claim_session_request` as the server's role, exactly as the Worker does. It then reads the results back and checks, per request: exactly one claim
accepted and one refused with the plain "Another tutor already accepted this request" words; the request ends `accepted` / `wallet_paid` for the winner only; one session;
one charge line, one hold line, no release line; the learner told once; and in total six sessions and R400 left in the wallet (R600 charged, none twice).

Run (from a copy of the repository whose `supabase/.temp` is linked to dev, with the Supabase CLI available):

    node supabase/tests/claim_race/claim-race.mjs            # set up, race, verify; leaves the fixture
    node supabase/tests/claim_race/claim-race.mjs --cleanup  # remove the fixture, restore the two settings

If the copy is not itself linked (the CLI lives in another folder), set `RACE_WORKDIR` to the linked folder. Starting the 12 processes 3 seconds apart is deliberate: the
Supabase pooler refuses a burst of temporary logins. Covered: the wallet-paid route (the live payment method). Not covered: the card route (mode `charge`), which has the same row lock.

## Extended race (job Q, 21 Nov 2026): three tutors, and the card route

    node supabase/tests/claim_race/claim-race-extended.mjs            # set up (setup-extended.sql), race, verify; leaves the fixture
    node supabase/tests/claim_race/claim-race-extended.mjs --cleanup  # same cleanup.sql as above

Same rules (dev only, refuses any other database, made-up people, 3-second process spacing). Each request is claimed by THREE tutors at the same instant (24 database connections in
all, one shared start instant on the database clock). Scenario W3: four wallet requests; exactly one claim wins and gets a session, the other two are refused with the plain "already accepted"
words; one session, one charge line, one hold line, no release, learner told once; R400 charged exactly once. Scenario C3: four card requests whose card check has passed; exactly one claim
wins and is told mode `charge` with a charge reference and the amount in cents; the request ends `charging` for that tutor only with that same reference; no session yet and nothing in the wallet
ledger (the Worker books after Paystack confirms; the database makes no Paystack call, and neither does this script). The wallet ledger cannot be deleted, so a few lines for the deleted made-up learner stay on dev.
