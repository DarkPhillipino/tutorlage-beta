import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';
import {
  HandOverClient, HandOverDeps, HandOverForm, HandOverResult, HandOverTutor, PastHandOvers, emptyHandOverForm, fetchPastHandOvers, prepareHandOver, recordDelivery,
} from '../lib/handOver';
import { HandOverPanelBody } from './HandOverPanelBody';

// "Prepare hand-over bundle" on a tutor's page. The work is in lib/handOver.ts; this holds the form and the buttons. Files are saved by the
// browser one by one (an anchor download), so the only secrets involved are the admin's own signed-in session.
const client = supabase as unknown as HandOverClient;

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const browserDeps: HandOverDeps = {
  fetchFile: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The file could not be fetched (${res.status}).`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '' };
  },
  sha256: async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
  save: (name, data, mime) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 15000);
  },
  now: () => new Date(),
};

export const HandOverPanel: React.FC<{ tutor: HandOverTutor; onDone: () => void }> = ({ tutor, onDone }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HandOverForm>(emptyHandOverForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HandOverResult | null>(null);
  const [past, setPast] = useState<PastHandOvers | null>(null);
  const [delivery, setDelivery] = useState({ method: '', address: '', recorded: false });
  const [deliverFor, setDeliverFor] = useState<string | null>(null);

  const loadPast = useCallback(() => {
    fetchPastHandOvers(client, tutor.id).then(setPast).catch((e) => setError(getErrorMessage(e, 'Could not load earlier hand-overs.')));
  }, [tutor.id]);
  useEffect(loadPast, [loadPast]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await prepareHandOver(client, browserDeps, tutor, form);
      setResult(made);
      setDelivery({ method: '', address: '', recorded: false });
      setDeliverFor(made.handOverId);
      onDone();
      loadPast();
    } catch (e) {
      setError(getErrorMessage(e, 'The bundle could not be prepared.'));
    } finally {
      setBusy(false);
    }
  };

  const deliver = async () => {
    if (!deliverFor) return;
    setBusy(true);
    setError(null);
    try {
      await recordDelivery(client, deliverFor, delivery.method, delivery.address);
      setDelivery((d) => ({ ...d, recorded: true }));
      loadPast();
    } catch (e) {
      setError(getErrorMessage(e, 'The delivery could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <HandOverPanelBody
      tutorName={tutor.name}
      open={open}
      form={form}
      busy={busy}
      error={error}
      result={result}
      past={past}
      deliverFor={deliverFor}
      delivery={delivery}
      onPickDelivery={(id) => { setDeliverFor(id); setDelivery({ method: '', address: '', recorded: false }); setError(null); }}
      onOpen={() => setOpen(true)}
      onChange={setForm}
      onPrepare={prepare}
      onDelivery={(d) => setDelivery((cur) => ({ ...cur, ...d }))}
      onRecordDelivery={deliver}
    />
  );
};
