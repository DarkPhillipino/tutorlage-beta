import { apiUrl, authHeaders } from './api';
import type { OnlineRequest } from './walletOnline';

// walletOnline.ts bound to the real Worker, for the screens (the same split as walletHooks.ts). Every call is a POST with the signed-in person's token and
// NO body: the Worker reads the payer from the token and the amount from the top-up row.
export const onlineRequest: OnlineRequest = async (path) => {
  let headers: Record<string, string>;
  try {
    headers = await authHeaders();
  } catch {
    // no session: the same answer the Worker would give
    return { status: 401, body: null };
  }
  const response = await fetch(apiUrl(path), { method: 'POST', headers });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // an answer with no JSON body: the status alone is used
  }
  return { status: response.status, body };
};

// Leaves the site for the bank's payment page. Kept here so the screens never write `window.location` themselves.
export function goToBankPage(address: string): void {
  window.location.assign(address);
}
