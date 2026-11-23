// START-PAGE CODE SPLIT (job T, 24 Nov 2026; branch code-split): the database library (supabase-js, about 58 kB compressed) is no longer in the first download of a visitor who has no
// saved sign-in. It is loaded the moment anything needs it (a sign-in or sign-up page, an e-mail link, a saved session). This tiny file, which is always in the first download, lets the
// parts that must know "the database client now exists" (the sign-in state, the currency symbols) hear about it, whichever page loaded it. No browser or database code in here.

let ready = false;
const waiting: Array<() => void> = [];

// Called once by supabaseClient.ts right after the client is created.
export function markSupabaseReady(): void {
  ready = true;
  for (const f of waiting.splice(0)) {
    try {
      f();
    } catch {
      // one listener failing must not stop the others
    }
  }
}

// Runs the function now if the client already exists, otherwise as soon as it is created. Returns a function that cancels the wait.
export function whenSupabaseReady(f: () => void): () => void {
  if (ready) {
    f();
    return () => {};
  }
  waiting.push(f);
  return () => {
    const i = waiting.indexOf(f);
    if (i >= 0) waiting.splice(i, 1);
  };
}

// Does this visit need the database client straight away? Yes when the browser holds a saved sign-in (a key sb-<project>-auth-token), when the address carries an e-mail-link
// result (tokens or an error in the fragment, a token in the query), or when browser storage cannot be read (then we cannot tell, so we load it as before). A signed-out visitor
// on the start page, the join page or any public page is the only "no".
export function needsSupabaseNow(win: { location: { hash: string; search: string }; localStorage?: Storage } | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return true;
  try {
    const store = win.localStorage;
    if (!store) return true;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) return true;
    }
  } catch {
    return true;
  }
  const hash = win.location.hash || '';
  const search = win.location.search || '';
  if (/access_token|refresh_token|error_description|error_code|[#&]error=|type=(recovery|signup|invite|magiclink|email_change)/i.test(hash)) return true;
  if (/[?&](token_hash|token|type|error_description|error_code|error)=/i.test(search)) return true;
  return false;
}
