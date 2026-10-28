import React, { useEffect, useState } from 'react';
import {
  CloseAccountSetup,
  ClosureClient,
  ClosurePreview,
  ClosureResult,
  fetchClosurePreview,
  plainMessage,
  requestClosure,
} from '../lib/closeAccount';
import { CloseAccountView, CloseStage } from './CloseAccountView';

// The close-account flow (legal B1 and B5): step 1 shows what closing does, step 2 asks for the typed word and a fresh password check.
// One flow for all three people: your own account (`learner` left out), or a guardian closing one child's account (`learner` given).
// The Supabase client is handed in, so this file never imports it. It does not call the Worker or Storage: the database does the rest.

interface CloseAccountFlowProps {
  client: ClosureClient;
  setup: CloseAccountSetup;
  learner?: { id: string; name: string };
  symbolOf?: (code: string) => string;
  onCancel: () => void;
  // Called once the database says the account is closed. For your own account the caller signs the person out.
  onClosed: (result: ClosureResult) => void;
}

export const CloseAccountFlow: React.FC<CloseAccountFlowProps> = ({ client, setup, learner, symbolOf, onCancel, onClosed }) => {
  const [stage, setStage] = useState<CloseStage>('loading');
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchClosurePreview(client, learner?.id)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setStage('preview');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(plainMessage(e));
        setStage('failed');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learner?.id]);

  const handleConfirm = async () => {
    setError(null);
    setStage('working');
    try {
      const result = await requestClosure(client, {
        word,
        password,
        email: setup.signInEmail,
        learnerId: learner?.id ?? null,
      });
      setPassword('');
      onClosed(result);
    } catch (e) {
      setPassword('');
      setError(plainMessage(e));
      setStage('confirm');
    }
  };

  return (
    <CloseAccountView
      stage={stage}
      subject={learner ? 'learner' : 'self'}
      learnerName={learner?.name}
      preview={preview}
      needsPassword={setup.signInEmail !== null}
      word={word}
      password={password}
      error={error}
      symbolOf={symbolOf}
      onWord={setWord}
      onPassword={setPassword}
      onContinue={() => { setError(null); setStage('confirm'); }}
      onBack={() => { setError(null); setStage('preview'); }}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    />
  );
};
