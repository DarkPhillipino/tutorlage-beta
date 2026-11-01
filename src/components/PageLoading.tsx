import React from 'react';
import { Loader2 } from 'lucide-react';

// Shown while a page's code or the sign-in state is loading.
export const PageLoading: React.FC<{ label?: string }> = ({ label = 'Loading Tutorlage…' }) => (
  <div role="status" className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-500">
    <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
    <span className="text-sm font-semibold">{label}</span>
  </div>
);
