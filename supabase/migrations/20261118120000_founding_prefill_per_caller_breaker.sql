-- 18 Nov 2026, road to P5 / OWASP review finding 2 (PM released it 18 Nov): founding_signup_prefill had ONE global circuit breaker: 60 well-formed but wrong tokens in 10 minutes made the pre-fill
-- answer nothing for EVERYBODY for the next 10 minutes, and any signed-out caller could trip it. The pre-fill is a convenience (the sign-up form opens empty instead), not a gate, and a token is 128 random
-- bits, so guessing is not the worry: the breaker only keeps noise down. Now the count is kept PER CALLER first (the same caller key the promo-code check uses: the address the gateway reports, 'ip:unknown'
-- when it reports none), 20 misses in 10 minutes for one caller; the global cap stays as the second line but is raised from 60 to 300 so one noisy caller can no longer switch it off for all.
-- Additive: one nullable column on the private lookup memory (no API role has any right on it) and the live function text patched in three places, each checked. Rollback: Drake/programmer/rollbacks/20261118120000_founding_prefill_per_caller_breaker_ROLLBACK.sql.
alter table public.founding_signup_lookups add column if not exists bucket text;

do $m$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.founding_signup_prefill(text)'::regprocedure);

  v_new := replace(v_def,
    E'  c_miss_cap constant integer := 60;\n',
    E'  c_miss_cap constant integer := 300;   -- everybody together (was 60)\n  c_caller_cap constant integer := 20;   -- one caller\n  v_key text := public.promo_attempt_key();\n');
  if v_new = v_def then raise exception 'founding_signup_prefill: the cap line was not found, nothing changed'; end if;
  v_def := v_new;

  v_new := replace(v_def,
    E'  if (select count(*) from public.founding_signup_lookups where created_at > now() - interval ''10 minutes'') >= c_miss_cap then return null; end if;\n',
    E'  if (select count(*) from public.founding_signup_lookups where bucket = v_key and created_at > now() - interval ''10 minutes'') >= c_caller_cap then return null; end if;\n'
    || E'  if (select count(*) from public.founding_signup_lookups where created_at > now() - interval ''10 minutes'') >= c_miss_cap then return null; end if;\n');
  if v_new = v_def then raise exception 'founding_signup_prefill: the breaker line was not found, nothing changed'; end if;
  v_def := v_new;

  v_new := replace(v_def,
    E'    insert into public.founding_signup_lookups default values;\n',
    E'    insert into public.founding_signup_lookups (bucket) values (v_key);\n');
  if v_new = v_def then raise exception 'founding_signup_prefill: the insert line was not found, nothing changed'; end if;

  execute v_new;
end
$m$;
