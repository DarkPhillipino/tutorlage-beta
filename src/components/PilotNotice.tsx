import React, { useEffect, useState } from 'react';
import { fetchPilotNotice, type PilotNotice as PilotNoticeValue } from '../lib/topupNotice';
import { walletDb } from '../lib/walletHooks';
import { PilotNoticeView } from './PilotNoticeView';

// The pilot notice for the Add-money screen and the wallet page: reads its words from the database (topupNotice.ts) and draws them (PilotNoticeView).
// Nothing is drawn until the answer arrives (so the built-in words never flash before the CEO's own), and the answer is always there: any trouble
// reading it gives the built-in words.
export const PilotNotice: React.FC<{ className?: string }> = ({ className }) => {
  const [notice, setNotice] = useState<PilotNoticeValue | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPilotNotice(walletDb).then((n) => {
      if (!cancelled) setNotice(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <PilotNoticeView notice={notice} className={className} />;
};
