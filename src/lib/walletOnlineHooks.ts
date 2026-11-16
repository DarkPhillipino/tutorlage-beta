import { useEffect, useState } from 'react';
import { apiUrl, authHeaders } from './api';
import { walletDb } from './walletHooks';
import { CARD_IS_MAIN, fetchMainWay, type MainWay, type OnlineGet, type OnlineRequest } from './walletOnline';

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

// The ONE call that is not a POST: the public question "are online payments set up here, and is it the test system?". No token, no body, nothing about the
// person (the Worker's answer is the same for everyone). Used only by useBankMainWay below.
export const onlineGet: OnlineGet = async (path) => {
  const response = await fetch(apiUrl(path), { method: 'GET' });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // an answer with no JSON body: the status alone is used
  }
  return { status: response.status, body };
};

// Is the bank the MAIN way to pay on the booking page, and is it the TEST system? Asked once when the price panel opens (`enabled`); false and "card is main"
// until the answer arrives and for any doubt (see fetchMainWay in walletOnline.ts).
export function useBankMainWay(enabled: boolean): MainWay {
  const [way, setWay] = useState<MainWay>(CARD_IS_MAIN);
  useEffect(() => {
    if (!enabled) {
      setWay(CARD_IS_MAIN);
      return undefined;
    }
    let cancelled = false;
    fetchMainWay(walletDb, onlineGet)
      .then((answer) => {
        if (!cancelled) setWay(answer);
      })
      .catch(() => {
        if (!cancelled) setWay(CARD_IS_MAIN);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return way;
}

// Leaves the site for the bank's payment page. Kept here so the screens never write `window.location` themselves.
export function goToBankPage(address: string): void {
  window.location.assign(address);
}
