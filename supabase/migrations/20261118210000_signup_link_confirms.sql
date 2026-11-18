-- 18 Nov 2026 (job T of the 18 Nov start brief; CEO ACCEPTED the proposal Drake/programmer/signup-confirmed-from-token-proposal-2026-11-18.md; PM's answers: the link-holder is trusted as the person,
-- the page shows the email from the list row with "Is this the right email?", the person sets their own password): a valid personal link makes the tutor account ALREADY CONFIRMED, made by the Worker
-- instead of the browser's own sign-up call, so the person never has to wait for a confirmation email.
-- THIS FILE IS THE DATABASE HALF. Purely ADDITIVE, SERVICE KEY ONLY (the Worker). Nothing that exists is changed and no grant is widened:
--   NEW  setting  signup_link_confirms   {"on": false}   OFF BY DEFAULT: while it is off, nothing a wave recipient meets changes (the Worker route and the page's second path both answer "not available" and
--                                                       the sign-up is exactly the ordinary one). The PM says when it goes on; going back off is one row update and is instant.
--   NEW  function founding_signup_resolve(p_token text, p_caller text)   service role only. Answers what the Worker needs to make the account (list row id, first name, surname, email, phone, date of
--        birth) or null. It answers null unless ALL of these hold: the setting is on; the token is the 32-hex shape and belongs to a row made by the form or by an admin; the row is "released" (the
--        place is open: the link is for people whose place opened) and not lapsed (released_messaged_at inside founding_release_lapse_days, default 14, when the message was marked as sent); the
--        row has no account (no user_id and no Auth user with the row's email: so a link works ONCE); and the row is COMPLETE (first name, surname and a real date of birth of 18 or over, in South
--        African time), because the Worker takes every detail from the row and never from the request. An incomplete row simply gets the ordinary sign-up.
--        Rate limit: the same memory as the pre-fill (founding_signup_lookups), counted per caller first (10 misses in 10 minutes; p_caller is the visitor's address as the Worker read it from
--        Cloudflare, because from the Worker the database cannot see the visitor) and then for everybody (the existing 300). A miss is written; a hit and a "setting off" answer are not.
-- NOT TOUCHED: founding_signup_prefill (the anon pre-fill), the sign-up trigger, the founding gate, any policy, any other function.
-- Rollback: Drake/programmer/rollbacks/20261118210000_signup_link_confirms_ROLLBACK.sql
insert into public.system_settings (setting_key, setting_value, description) values (
  'signup_link_confirms',
  '{"on": false}'::jsonb,
  'When on, a valid personal sign-up link (tutorlage.com/signup/tutor?k=...) makes the tutor account already confirmed (no confirmation email), created by the Worker. Off = the ordinary sign-up with a confirmation email.'
)
on conflict (setting_key) do nothing;

create or replace function public.founding_signup_resolve(p_token text, p_caller text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_caller_cap constant integer := 10;
  c_miss_cap constant integer := 300;
  v_tok text := lower(btrim(coalesce(p_token, '')));
  v_key text := 'w:' || left(coalesce(nullif(btrim(coalesce(p_caller, '')), ''), 'unknown'), 64);
  v_days integer;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  e record;
  v_digits text;
  v_phone text;
begin
  -- the switch: while it is off there is nothing to look up and nothing to count
  if not coalesce((select s.setting_value ->> 'on' = 'true' from public.system_settings s where s.setting_key = 'signup_link_confirms'), false) then
    return null;
  end if;
  if v_tok !~ '^[0-9a-f]{32}$' then return null; end if;
  if (select count(*) from public.founding_signup_lookups where bucket = v_key and created_at > now() - interval '10 minutes') >= c_caller_cap then return null; end if;
  if (select count(*) from public.founding_signup_lookups where created_at > now() - interval '10 minutes') >= c_miss_cap then return null; end if;

  select case when jsonb_typeof(s.setting_value) = 'number' then (s.setting_value #>> '{}')::numeric::integer end into v_days
    from public.system_settings s where s.setting_key = 'founding_release_lapse_days';
  v_days := greatest(coalesce(v_days, 14), 1);

  select f.id, f.first_name, f.surname, f.email, f.whatsapp, f.date_of_birth into e
  from public.founding_tutors_list f
  where f.signup_token = v_tok
    and f.source in ('form', 'admin')
    and f.status = 'released'
    and f.user_id is null
    and f.email_key is not null
    and (f.released_messaged_at is null or f.released_messaged_at > now() - make_interval(days => v_days))
    and nullif(btrim(coalesce(f.first_name, '')), '') is not null
    and nullif(btrim(coalesce(f.surname, '')), '') is not null
    and f.date_of_birth is not null
    and f.date_of_birth between date '1900-01-01' and v_today
    and extract(year from age(v_today, f.date_of_birth)) between 18 and 119
    and not exists (select 1 from auth.users u where lower(btrim(u.email)) = f.email_key);
  if not found then
    insert into public.founding_signup_lookups (bucket) values (v_key);
    delete from public.founding_signup_lookups where created_at < now() - interval '1 day';
    return null;
  end if;

  v_digits := regexp_replace(coalesce(e.whatsapp, ''), '[^0-9]', '', 'g');
  v_phone := case when v_digits ~ '^27[0-9]{9}$' then '0' || substr(v_digits, 3) end;
  return jsonb_build_object(
    'row_id', e.id,
    'first_name', btrim(e.first_name),
    'surname', btrim(e.surname),
    'email', e.email,
    'phone', v_phone,
    'date_of_birth', e.date_of_birth);
end;
$$;
revoke all on function public.founding_signup_resolve(text, text) from public, anon, authenticated;
grant execute on function public.founding_signup_resolve(text, text) to service_role;
