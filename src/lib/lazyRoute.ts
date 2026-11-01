import { lazy, type ComponentType } from 'react';

// A page loaded on demand (PERF-BUNDLE-01: the first download carries only what the first screen needs, which matters on mobile data).
// Loading a page's code can fail for two ordinary reasons here: the phone lost signal for a moment (load-shedding, a lift), or the site
// was republished while a tab was open, so the old tab asks for a file name that no longer exists. Both are answered the same way:
// try once more after a second, and if that fails reload the page once to pick up the new file names (a flag in sessionStorage stops a
// reload loop; after that the error screen's "Reload the page" button is what the person sees).
const RELOADED_KEY = 'tutorlage-chunk-reload';

export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const loaded = await load();
      clearChunkReloadFlag();
      return loaded;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const loaded = await load();
        clearChunkReloadFlag();
        return loaded;
      } catch (err) {
        // No signal: a reload would swap the app for the browser's "no internet" page, so show the app's own error screen instead
        // (it has a reload button, and the person's place is kept until they press it).
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        let alreadyReloaded = true;
        try {
          alreadyReloaded = sessionStorage.getItem(RELOADED_KEY) !== null;
          if (!alreadyReloaded && !offline) sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
        } catch {
          // Storage can be blocked (private windows): never reload without a way to stop.
        }
        if (!alreadyReloaded && !offline) {
          window.location.reload();
          // Hold this page's render until the reload happens, so the error screen does not flash first.
          return new Promise<never>(() => {});
        }
        throw err;
      }
    }
  });
}

// Forgets the one-reload flag once a page's code has loaded fine, so a later republish can use it again. (Only after a successful
// load: clearing it earlier would let a page that keeps failing reload for ever.)
function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // ignore
  }
}
