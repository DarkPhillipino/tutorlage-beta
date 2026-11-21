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
