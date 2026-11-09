import React from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAdminAuth } from '../lib/AuthContext';
import { PromoCodesBody } from '../components/PromoCodesBody';
import type { PromoAdminClient } from '../lib/promoCodes';

const client = supabase as unknown as PromoAdminClient;

// The Codes page (PROMO CODES, CEO's decision of 5 Nov 2026). The screen is PromoCodesBody; this wrapper only gives it the admin app's own client and the signed-in role.
export const PromoCodes: React.FC = () => {
  const { adminProfile } = useAdminAuth();
  return <PromoCodesBody client={client} role={adminProfile?.adminRole} />;
};
