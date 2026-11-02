import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ACCESS_LOG_NOT_ACTIVE_NOTE } from '../lib/documentAccess';
import type { ViewedDocument } from '../lib/documentViewing';

// Shows a stored document inside the admin app (documentViewing.ts holds the rules). The file's bytes sit in this window's memory only:
// the address made for it is revoked when the window closes or moves to another file, and nothing is saved, shared or put in the
// browser's history. Each file is opened (and so recorded in the access log) when it is first shown, never ahead of time.

export interface ViewerDocument {
  key: string;
  title: string;
  // For example "Uploaded 31/10/2026, 21:14 · JPG photo · waiting for review"
  subtitle?: string;
  // Records the opening and reads the file; see viewStoredDocument().
  open: () => Promise<ViewedDocument>;
}

interface DocumentViewerProps {
  documents: ViewerDocument[];
  startIndex?: number;
  onClose: () => void;
  // Called each time a file has been opened (recorded), so the page can refresh its access list and the "log not active" note.
  onOpened?: (viewed: ViewedDocument) => void;
}

type Shown =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; kind: 'image' | 'pdf'; url: string }
  | { state: 'link'; url: string };

const ZOOMS = [1, 1.5, 2, 3];

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ documents, startIndex = 0, onClose, onOpened }) => {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(documents.length - 1, 0)));
  const [shown, setShown] = useState<Shown>({ state: 'loading' });
  const [turns, setTurns] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // false only when the database has no access log yet; null until a file has been opened.
  const [recorded, setRecorded] = useState<boolean | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const current = documents[index];

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setShown({ state: 'loading' });
    setTurns(0);
    setZoom(0);
    current
      .open()
      .then((viewed) => {
        if (cancelled) return;
        setRecorded(viewed.logged);
        onOpened?.(viewed);
        if (viewed.kind === 'link') {
          setShown({ state: 'link', url: viewed.url });
          return;
        }
        objectUrl = URL.createObjectURL(viewed.blob);
        setShown({ state: 'ready', kind: viewed.kind, url: objectUrl });
      })
      .catch((e) => {
        if (!cancelled) setShown({ state: 'error', message: e instanceof Error && e.message ? e.message : 'Could not open this document.' });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // onOpened is deliberately not a dependency: changing it must not open (and record) the same file again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, attempt]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(documents.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, documents.length]);

  if (!current) return null;
  const many = documents.length > 1;
  const scale = ZOOMS[zoom];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={current.title}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-[#0F172A] truncate">{current.title}</p>
            {current.subtitle && <p className="text-[11px] text-slate-500 truncate">{current.subtitle}</p>}
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close the document" className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-100 bg-slate-50 text-xs">
          {many && (
            <>
              <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Previous document" className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-bold text-slate-600" aria-live="polite">Document {index + 1} of {documents.length}</span>
              <button type="button" onClick={() => setIndex(index + 1)} disabled={index === documents.length - 1} aria-label="Next document" className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
          {shown.state === 'ready' && shown.kind === 'image' && (
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => setTurns((t) => (t + 1) % 4)} aria-label="Turn the picture a quarter turn" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-600 cursor-pointer">
                <RotateCw className="w-3.5 h-3.5" /> Turn
              </button>
              <button type="button" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out" className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="w-12 text-center font-bold text-slate-600">{zoom === 0 ? 'Fit' : `${Math.round(scale * 100)}%`}</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in" className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 bg-slate-100 overflow-auto flex items-center justify-center">
          {shown.state === 'loading' && (
            <div className="flex items-center text-slate-500 text-sm font-semibold" role="status">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Opening and recording the opening…
            </div>
          )}
          {shown.state === 'error' && (
            <div className="max-w-md text-center p-6" role="alert">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-[#0F172A] mb-1">This document could not be shown</p>
              <p className="text-xs text-rose-600 font-semibold mb-3">{shown.message}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="bg-[#0F172A] text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer">Try again</button>
            </div>
          )}
          {shown.state === 'link' && (
            <div className="max-w-md text-center p-6">
              <p className="text-sm font-bold text-[#0F172A] mb-1">This is a web address, not a stored file</p>
              <p className="text-xs text-slate-500 mb-3">It is the tutor's own page, so it opens in your normal browser. Treat it with care.</p>
              <a href={shown.url} target="_blank" rel="noopener noreferrer" className="inline-block bg-[#0F172A] text-white text-xs font-bold px-4 py-2 rounded-lg">Open in the browser</a>
            </div>
          )}
          {shown.state === 'ready' && shown.kind === 'image' && (
            <div style={{ transform: `rotate(${turns * 90}deg)`, width: zoom === 0 ? undefined : `${scale * 100}%`, maxWidth: zoom === 0 ? '100%' : 'none' }} className="shrink-0 p-4">
              <img
                src={shown.url}
                alt={current.title}
                draggable={false}
                className={zoom === 0 ? 'max-w-full max-h-[62vh] object-contain mx-auto' : 'w-full h-auto'}
              />
            </div>
          )}
          {shown.state === 'ready' && shown.kind === 'pdf' && <iframe src={shown.url} title={current.title} className="w-full h-full border-0 bg-white" />}
        </div>

        <p className={`px-5 py-2 text-[11px] border-t border-slate-100 ${recorded === false ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
          {recorded === false
            ? ACCESS_LOG_NOT_ACTIVE_NOTE
            : 'Opening this document was recorded in the access log. It is shown here only; Tutorlage Admin does not save it.'}
        </p>
      </div>
    </div>
  );
};
