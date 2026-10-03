// The supplier details ECTA s43 requires on the site (legal name, registration
// number, physical address, contact details). One place to fill them in — see
// Drake/legal/specs/7k-minors-consent-and-acceptance.md §6.
//
// Deliberately null until the real values exist (the company is registered at
// launch; the support address is still being set up). Footer.tsx hides the
// block entirely while anything here is missing, rather than showing
// placeholders — legal's rule is never to publish placeholder supplier details.
// Filling this in is a launch gate, not optional polish.
export interface BusinessInfo {
  legalName: string | null;
  registrationNumber: string | null;
  physicalAddress: string | null;
  email: string | null;
  phone: string | null;
}

export const BUSINESS_INFO: BusinessInfo = {
  legalName: null,
  registrationNumber: null,
  physicalAddress: null,
  email: null,
  phone: null,
};

export function isBusinessInfoComplete(info: BusinessInfo = BUSINESS_INFO): boolean {
  return Object.values(info).every((value) => typeof value === 'string' && value.trim() !== '');
}
