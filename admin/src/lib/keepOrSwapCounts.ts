// Keep or swap, counted for the admin (master items 7aa + 7da; the CEO's principle of 14 Oct 2026): how many learners kept a
// tutor, how many chose to try someone else, and how many pairings a tutor ended, by tutor. PRIVATE to admins: a tutor never
// sees these numbers (the database has no policy that lets a tutor read the choices), and nothing here is used for any automatic
// penalty; it is a signal for the CEO, like "learners who stopped while their tutor kept working". Pure, so
// scripts/dev/keep-or-swap-test.ts can check it exactly.

export interface ChoiceRow {
  tutor_id: string;
  choice: string; // 'keep' | 'avoid'
}

export interface EndedRow {
  tutor_id: string;
}

export interface TutorCountLine {
  tutorId: string;
  name: string;
  kept: number;
  avoided: number;
  ended: number;
}

export interface KeepOrSwapCounts {
  kept: number;
  avoided: number;
  ended: number;
  lines: TutorCountLine[]; // most "tried someone else" first, then most kept
}

export function countKeepOrSwap(choices: ChoiceRow[], ended: EndedRow[], names: Map<string, string>): KeepOrSwapCounts {
  const byTutor = new Map<string, TutorCountLine>();
  const line = (tutorId: string): TutorCountLine => {
    let l = byTutor.get(tutorId);
    if (!l) {
      l = { tutorId, name: names.get(tutorId)?.trim() || `Tutor ${tutorId.slice(0, 8)}`, kept: 0, avoided: 0, ended: 0 };
      byTutor.set(tutorId, l);
    }
    return l;
  };
  let kept = 0;
  let avoided = 0;
  for (const c of choices) {
    if (c.choice === 'keep') {
      line(c.tutor_id).kept++;
      kept++;
    } else if (c.choice === 'avoid') {
      line(c.tutor_id).avoided++;
      avoided++;
    }
  }
  for (const e of ended) line(e.tutor_id).ended++;
  return {
    kept,
    avoided,
    ended: ended.length,
    lines: [...byTutor.values()].sort((a, b) => b.avoided - a.avoided || b.kept - a.kept || a.name.localeCompare(b.name)),
  };
}
