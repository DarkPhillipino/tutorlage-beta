import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { metaForPath, titleForPath } from '../lib/pageMeta';

// Keeps the browser tab's title (and the page description) right when someone moves between pages without a reload. The first load
// already has the right ones: the build writes them into each page's HTML (scripts/postbuild.ts). Renders nothing.
export const RouteMeta: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = titleForPath(pathname);
    if (title) document.title = title;
    const description = metaForPath(pathname)?.description;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [pathname]);
  return null;
};
