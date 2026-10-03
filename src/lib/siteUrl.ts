// The path the site is served under: '' locally, '/tutorlage-beta' on GitHub Pages (vite.config.ts
// `base`). Without it the router and the return addresses below point at the domain root, which on
// GitHub Pages is someone else's space and answers "not found".
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

// A full address on this site, for trips that leave it and come back: Google sign-in, Paystack's
// checkout, the signup confirmation email. Supabase only returns to addresses on its allow list
// (Authentication → URL Configuration), so each site's address has to be listed there.
export function siteUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path}`;
}
