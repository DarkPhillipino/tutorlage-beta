import React from 'react';
import { AccountClosedView } from '../components/AccountClosedView';
import { recallClosure } from '../lib/closeAccount';
import { SUPPORT_EMAIL } from '../lib/businessInfo';
import { BASE_PATH } from '../lib/siteUrl';

// Where a person lands after closing their own account (src/components/CloseAccountSection.tsx). Public on purpose: they are signed out
// by then. The dates come from the browser's session storage, left there a moment ago; without them the page gives the general version.
export default function AccountClosed() {
  return <AccountClosedView result={recallClosure()} signInHref={`${BASE_PATH}/login`} supportEmail={SUPPORT_EMAIL} />;
}
