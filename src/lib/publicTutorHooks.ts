import { useEffect, useState } from 'react';
import { fetchPublicPage, type PublicPageClient, type PublicTutorPage } from './publicTutorPage';

// The public answer for one tutor's code: undefined while it is being read, null when there is no page.
export function usePublicTutor(client: PublicPageClient, code: string): PublicTutorPage | null | undefined {
  const [page, setPage] = useState<PublicTutorPage | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setPage(undefined);
    if (!code) {
      setPage(null);
      return undefined;
    }
    fetchPublicPage(client, code).then((p) => {
      if (live) setPage(p);
    });
    return () => {
      live = false;
    };
  }, [client, code]);
  return page;
}

// noindex, nofollow: set on the robots line the page already has (the host's 404 copy carries one), or add one
export function useNoIndex(): void {
  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const before = existing?.content ?? null;
    const meta = existing ?? Object.assign(document.createElement('meta'), { name: 'robots' });
    meta.content = 'noindex,nofollow';
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (existing && before !== null) existing.content = before;
      else if (!existing) meta.remove();
    };
  }, []);
}
