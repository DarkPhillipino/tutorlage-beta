-- 18 Nov 2026, follow-up to 20261118140000 (applied together): the three admin functions are for signed-in admins only (the officer-or-super-admin check is inside);
-- the server key does not need them, so its right is taken away (same as 20261118130000's follow-up for admin_approve_subjects_on_credential).
revoke execute on function public.admin_grant_module7_exemption(uuid, text, integer, text) from service_role;
revoke execute on function public.admin_end_module7_exemption(uuid, text) from service_role;
revoke execute on function public.admin_module7_exemption(uuid) from service_role;
