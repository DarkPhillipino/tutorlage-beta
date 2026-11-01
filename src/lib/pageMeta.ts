// What search engines and link previews are told about each public address (release gate SEO-META-01). One table, used twice:
//  - the build step (scripts/postbuild.ts) writes a copy of the page for every address below, with its own title, description,
//    canonical address and robots line, plus sitemap.xml and robots.txt, so a crawler or a WhatsApp preview that never runs
//    JavaScript still sees the right words (GitHub Pages cannot answer a direct visit to /terms any other way);
//  - the app (RouteMeta) keeps the browser tab's title in step when someone moves between pages without a reload.
// Every description is a plain statement the app makes true today (no earnings, no "certified" or "qualified" claims).
export const SITE_ORIGIN = 'https://tutorlage.com';
export const SITE_NAME = 'Tutorlage';
export const SHARE_IMAGE_PATH = '/og-image.png';
export const SHARE_IMAGE_ALT = 'Tutorlage: online tutoring in South Africa';

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  // false: kept out of search results and out of sitemap.xml (private or one-use pages).
  index: boolean;
}

export const HOME_DESCRIPTION =
  'Send one request with your subject and grade, and a tutor who fits accepts it. Online tutoring in South Africa for school learners and university students.';

const ROLES = ['student', 'tutor', 'parent'] as const;

export const PAGE_META: PageMeta[] = [
  { path: '/', title: 'Tutorlage | Online tutoring in South Africa', description: HOME_DESCRIPTION, index: true },
  { path: '/login', title: 'Sign in or join | Tutorlage', description: 'Sign in to Tutorlage, or join as a tutor, a student, or a parent or guardian.', index: true },
  { path: '/signup/tutor', title: 'Become a tutor | Tutorlage', description: 'Create a tutor account on Tutorlage. Tutors must be 18 or older and give an ID or passport and a police clearance certificate.', index: true },
  { path: '/signup/student', title: 'Join as a student | Tutorlage', description: 'Create a student account on Tutorlage to book an online tutor. Students must be 18 or older; learners under 18 are booked for by a parent or guardian.', index: true },
  { path: '/signup/parent', title: 'Join as a parent or guardian | Tutorlage', description: 'Create a parent or guardian account on Tutorlage to book online tutoring for a learner under 18.', index: true },
  { path: '/terms', title: 'Terms of Service | Tutorlage', description: 'The terms for using Tutorlage as a learner, parent or guardian, or tutor.', index: true },
  { path: '/privacy', title: 'Privacy Policy | Tutorlage', description: 'What personal information Tutorlage collects, why, who sees it and how long it is kept.', index: true },
  { path: '/refunds', title: 'Refund Policy | Tutorlage', description: 'When Tutorlage refunds a booking, and how.', index: true },
  ...ROLES.map((r): PageMeta => ({ path: `/signin/${r}`, title: 'Sign in | Tutorlage', description: 'Sign in to your Tutorlage account.', index: false })),
  { path: '/forgot-password', title: 'Reset your password | Tutorlage', description: 'Ask for a link to choose a new Tutorlage password.', index: false },
  ...ROLES.map((r): PageMeta => ({ path: `/forgot-password/${r}`, title: 'Reset your password | Tutorlage', description: 'Ask for a link to choose a new Tutorlage password.', index: false })),
  { path: '/reset-password', title: 'Choose a new password | Tutorlage', description: 'Choose a new Tutorlage password.', index: false },
  { path: '/auth/callback', title: 'Signing you in | Tutorlage', description: 'Finishing your sign-in to Tutorlage.', index: false },
  { path: '/account-closed', title: 'Account closed | Tutorlage', description: 'Your Tutorlage account has been closed.', index: false },
  { path: '/payment/callback', title: 'Confirming your card | Tutorlage', description: 'Confirming your card with Tutorlage.', index: false },
  { path: '/room', title: 'Video room | Tutorlage', description: 'Tutorlage video room.', index: false },
  { path: '/tutor-documents', title: 'Your documents | Tutorlage', description: 'Add the documents Tutorlage needs to verify a tutor.', index: false },
];

export const NOT_FOUND_META = {
  title: 'Page not found | Tutorlage',
  description: 'That page does not exist on Tutorlage.',
};

// Paths that start here belong to a signed-in page whose address carries a code (a video room), so they have no entry of their own.
const PREFIX_TITLES: Array<[string, string]> = [['/room/', 'Video room | Tutorlage']];

export function normalisePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

export function metaForPath(pathname: string): PageMeta | null {
  const p = normalisePath(pathname);
  return PAGE_META.find((m) => m.path === p) ?? null;
}

export function titleForPath(pathname: string): string | null {
  const exact = metaForPath(pathname);
  if (exact) return exact.title;
  const p = normalisePath(pathname);
  const prefix = PREFIX_TITLES.find(([start]) => p.startsWith(start));
  return prefix ? prefix[1] : null;
}
