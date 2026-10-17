import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LevelsBody, LevelsData } from '../components/LevelsBody';
import { TutorLevelCardBody } from '../components/TutorLevelCardBody';
import type { LevelActions, TutorLevelActions } from '../lib/levelActions';
import type { TutorLevelInfo, VerificationDocument } from '../types';
import '../index.css';

// A practice copy of the Levels screen and of a tutor's Level section, with the ladder as it was on 17 Oct 2026 and pretend actions
// that change only this page (nothing is sent anywhere, no sign-in needed). Open http://localhost:3100/dev-levels.html while the
// admin app is running. The real screens are pages/Levels.tsx and components/TutorLevelCard.tsx.

const TIERS: LevelsData['tiers'] = [
  { id: 1, publicName: 'Rising Tutors', quote: 'Tutors new to Tutorlage, building their record.', minRate: 50, maxRate: 150, sharePct: 30, currencyCode: 'ZAR' },
  { id: 2, publicName: 'Academic Mentors', quote: 'Tutors with a strong record on Tutorlage.', minRate: 180, maxRate: 350, sharePct: 25, currencyCode: 'ZAR' },
  { id: 3, publicName: 'Subject Specialists', quote: 'Experienced tutors.', minRate: 400, maxRate: 600, sharePct: 22, currencyCode: 'ZAR' },
  { id: 4, publicName: 'Distinction Strategists', quote: 'Tutors who mark or moderate exam papers.', minRate: 650, maxRate: 1200, sharePct: 20, currencyCode: 'ZAR' },
];
const L: [string, number, number, number, number, number, number, number, number][] = [
  ['1A', 1, 50, 0, 0, 0, 0, 0, 0], ['1B', 1, 80, 10, 4.8, 0, 0, 0, 0], ['1C', 1, 110, 25, 4.85, 60, 0, 0, 0], ['1D', 1, 150, 45, 4.9, 60, 3, 0, 0],
  ['2A', 2, 180, 50, 4.85, 65, 5, 0, 5], ['2B', 2, 230, 75, 4.88, 68, 7, 0, 5], ['2C', 2, 280, 110, 4.9, 72, 10, 0, 5], ['2D', 2, 350, 150, 4.9, 75, 12, 5, 10],
  ['3A', 3, 400, 160, 4.9, 75, 12, 5, 10], ['3B', 3, 460, 210, 4.92, 78, 15, 6, 12], ['3C', 3, 530, 270, 4.93, 82, 20, 8, 15], ['3D', 3, 600, 350, 4.95, 85, 25, 10, 20],
  ['4A', 4, 650, 360, 4.95, 85, 25, 10, 20], ['4B', 4, 720, 420, 4.96, 88, 30, 12, 22], ['4C', 4, 800, 500, 4.97, 90, 35, 15, 25], ['4D', 4, 1200, 600, 4.98, 92, 40, 20, 25],
];
const LEVELS: LevelsData['levels'] = L.map(([id, tierId, price, minHours, minRating, minRepeatPct, minReviews, minStudents, uplift]) => ({
  id, tierId, price, minHours, minRating, minRepeatPct, minReviews, minStudents, uplift, sharePct: 25,
}));
const CREDS: LevelsData['credentials'] = [
  { code: 'higher_certificate_education', label: 'Higher Certificate in Education', entrySubTier: '2A', recencyYears: null, description: 'A completed one-year Higher Certificate in Education.', heldBy: 0 },
  { code: 'practicum_complete', label: 'Student teacher with a completed supervised practicum', entrySubTier: '2C', recencyYears: null, description: 'Completed supervised classroom practice as part of a B.Ed or PGCE.', heldBy: 1 },
  { code: 'teaching_degree', label: 'Qualified teacher with a teaching degree or PGCE', entrySubTier: '2C', recencyYears: null, description: 'A completed teaching degree (for example a 4-year B.Ed) or a PGCE.', heldBy: 0 },
  { code: 'exam_marker', label: 'NSC, IEB or Cambridge exam marker (last 5 years)', entrySubTier: '4A', recencyYears: 5, description: 'Appointed to mark exit-level papers within the recency window.', heldBy: 0 },
  { code: 'admin_assigned', label: 'Level assigned by Tutorlage', entrySubTier: null, recencyYears: null, description: 'A level an administrator chose for one tutor, with the reason.', heldBy: 1 },
];

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 150));
const log: string[] = [];

function Preview() {
  const [data, setData] = useState<LevelsData>({ tiers: TIERS, levels: LEVELS, credentials: CREDS });
  const [lines, setLines] = useState<string[]>([]);
  const note = (text: string) => {
    log.unshift(text);
    setLines([...log].slice(0, 8));
  };

  const actions: LevelActions = {
    async saveTier(t) {
      await pause();
      setData((d) => ({ ...d, tiers: d.tiers.map((x) => (x.id === t.id ? { ...x, ...t } : x)) }));
      note(`saveTier ${JSON.stringify(t)}`);
    },
    async saveLevel(l) {
      await pause();
      if (l.id === '9Z') throw new Error('Pretend the database refused this level');
      setData((d) => ({ ...d, levels: d.levels.some((x) => x.id === l.id) ? d.levels.map((x) => (x.id === l.id ? l : x)) : [...d.levels, l] }));
      note(`saveLevel ${JSON.stringify(l)}`);
    },
    async saveCredentialDefinition(c) {
      await pause();
      setData((d) => ({
        ...d,
        credentials: d.credentials.some((x) => x.code === c.code)
          ? d.credentials.map((x) => (x.code === c.code ? { ...x, ...c } : x))
          : [...d.credentials, { ...c, heldBy: 0 }],
      }));
      note(`saveCredentialDefinition ${JSON.stringify(c)}`);
    },
    async deleteCredentialDefinition(code) {
      await pause();
      setData((d) => ({ ...d, credentials: d.credentials.filter((x) => x.code !== code) }));
      note(`deleteCredentialDefinition ${code}`);
    },
    async recalculateAllLevels() {
      await pause();
      note('recalculateAllLevels');
      return 6;
    },
  };

  const [info, setInfo] = useState<TutorLevelInfo>({
    currentLevel: '2C',
    floorLevel: '2C',
    frozen: false,
    freezeReason: null,
    credentials: [
      { id: 'c1', code: 'teaching_degree', label: 'Qualified teacher with a teaching degree or PGCE', level: '2C', obtainedOn: '2024-11-30', note: 'B.Ed, 4 years', documentId: 'd1', status: 'verified' },
    ],
  });
  const docs: VerificationDocument[] = [
    { id: 'd1', tutorId: 't', documentType: 'teaching_qualification', documentUrl: 't/x.pdf', status: 'verified', adminNotes: null, uploadedAt: '2026-10-10T08:00:00Z', reviewedAt: null, issuedOn: null },
    { id: 'd2', tutorId: 't', documentType: 'proof_of_experience', documentUrl: 'https://www.superprof.co.za/tutor/x', status: 'pending', adminNotes: null, uploadedAt: '2026-10-12T08:00:00Z', reviewedAt: null, issuedOn: null },
  ];
  const tutorActions: TutorLevelActions = {
    async assignTutorLevel(_t, level, reason) {
      await pause();
      setInfo((i) => ({
        ...i,
        currentLevel: level,
        floorLevel: level,
        credentials: [
          { id: 'a1', code: 'admin_assigned', label: 'Level assigned by Tutorlage', level, obtainedOn: null, note: reason, documentId: null, status: 'verified' },
          ...i.credentials.filter((c) => c.code !== 'admin_assigned'),
        ],
      }));
      note(`assignTutorLevel ${level} (${reason})`);
    },
    async clearTutorAssignedLevel(_t, reason) {
      await pause();
      setInfo((i) => ({ ...i, currentLevel: '2C', floorLevel: '2C', credentials: i.credentials.filter((c) => c.code !== 'admin_assigned') }));
      note(`clearTutorAssignedLevel (${reason})`);
    },
    async recordTutorCredential(_t, code, obtainedOn, documentId, text) {
      await pause();
      const def = data.credentials.find((c) => c.code === code);
      setInfo((i) => ({
        ...i,
        credentials: [{ id: `r${i.credentials.length}`, code, label: def?.label ?? code, level: def?.entrySubTier ?? null, obtainedOn, note: text || null, documentId, status: 'verified' }, ...i.credentials],
      }));
      note(`recordTutorCredential ${code}`);
    },
    async removeTutorCredential(id, reason) {
      await pause();
      setInfo((i) => ({ ...i, credentials: i.credentials.filter((c) => c.id !== id) }));
      note(`removeTutorCredential ${id} (${reason})`);
    },
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#0F172A] p-8 space-y-10">
      <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 max-w-4xl">
        Practice copy: nothing here is saved anywhere.
      </p>
      <LevelsBody data={data} actions={actions} onSaved={() => undefined} />
      <div className="max-w-2xl">
        <h2 className="text-lg font-extrabold mb-3">A tutor's page: the Level section</h2>
        <TutorLevelCardBody tutorId="t" documents={docs} info={info} levels={data.levels} definitions={data.credentials} actions={tutorActions} onChanged={() => undefined} />
      </div>
      <pre id="action-log" className="text-[11px] bg-white border border-slate-200 rounded-xl p-3 max-w-4xl whitespace-pre-wrap">{lines.join('\n') || 'No actions yet.'}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
