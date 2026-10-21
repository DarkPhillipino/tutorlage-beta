-- Pin the search_path of the four legacy SECURITY DEFINER functions that never had one (the standing rule: every SECURITY DEFINER
-- function sets search_path = public). Supabase's security advisor flagged them, and the programmer's own catalog check found the
-- same four on dev and on production: fn_accept_session_request, fn_decline_session_request, fn_expire_stale_session_requests and
-- handle_new_user. They are left over from the first beta, are not executable by anon or signed-in users (20260930230000), and are
-- used by no trigger, cron job, policy or other function; the signup trigger on auth.users calls handle_new_user_role_expansion().
--
-- Nothing else changes: no body, signature, owner or grant is touched, and none of the four is dropped.

alter function public.fn_accept_session_request(uuid) set search_path = public;
alter function public.fn_decline_session_request(uuid, text) set search_path = public;
alter function public.fn_expire_stale_session_requests(integer) set search_path = public;
alter function public.handle_new_user() set search_path = public;
