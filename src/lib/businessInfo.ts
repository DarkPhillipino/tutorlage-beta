// The supplier details ECTA s43 requires on the site (legal name, registration
// number, physical address, contact details). One place to fill them in — see
// Drake/legal/specs/7k-minors-consent-and-acceptance.md §6.
//
// Footer.tsx hides the block entirely while anything here is missing, and the
// test phase 1 notice (LegalPage.tsx) only renders once it's complete — legal's
// rule is never to publish placeholder supplier details. Directors' names
// (ECTA s43(1)(f) "office bearers") are still to add before real payments.
export interface BusinessInfo {
  legalName: string | null;
  registrationNumber: string | null;
  physicalAddress: string | null;
  email: string | null;
  phone: string | null;
}

// Supplied by the CEO on 2026-10-04: CIPC enterprise number and name
// (registered 2026-10-02 as a private company), address and phone.
export const BUSINESS_INFO: BusinessInfo = {
  legalName: 'Tutorlage (Pty) Ltd',
  registrationNumber: 'K2026791986',
  physicalAddress: '1 Aventino Lane, Glen Erasmia, Kempton Park, South Africa',
  email: 'support@tutorlage.com',
  phone: '+27 76 388 5333',
};

// Cloudflare Email Routing addresses on tutorlage.com, forwarding to the CEO
// (set up by the CEO; MX records checked 2026-10-03). Used by the Help button
// and the test phase 1 tester notice.
export const SUPPORT_EMAIL = 'support@tutorlage.com';
export const SAFETY_EMAIL = 'safety@tutorlage.com';

export function isBusinessInfoComplete(info: BusinessInfo = BUSINESS_INFO): boolean {
  return Object.values(info).every((value) => typeof value === 'string' && value.trim() !== '');
}
