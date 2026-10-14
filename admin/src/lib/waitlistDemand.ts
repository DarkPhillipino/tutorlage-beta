// Unmet demand from the "tell me when a tutor is available" list (master item 7cz): how many people are waiting for a
// subject and grade nobody teaches yet. Pure, so scripts/dev/waitlist-test.ts can check it exactly.

export interface WaitlistRow {
  subject: string;
  grade_level: string | null;
  notified_at: string | null;
}

export interface DemandLine {
  subject: string;
  gradeLevel: string;   // 'Any grade' when none was given
  waiting: number;      // still waiting for a tutor
  told: number;         // already told that a tutor is available
}

export interface WaitlistDemand {
  waiting: number;
  told: number;
  lines: DemandLine[];  // most waiting first
}

const key = (subject: string, grade: string | null) => `${subject.trim().toLowerCase()}|${(grade ?? '').trim().toLowerCase()}`;

export function groupWaitlistDemand(rows: WaitlistRow[]): WaitlistDemand {
  const lines = new Map<string, DemandLine>();
  let waiting = 0;
  let told = 0;
  for (const row of rows) {
    const k = key(row.subject, row.grade_level);
    let line = lines.get(k);
    if (!line) {
      line = { subject: row.subject.trim(), gradeLevel: (row.grade_level ?? '').trim() || 'Any grade', waiting: 0, told: 0 };
      lines.set(k, line);
    }
    if (row.notified_at) {
      line.told++;
      told++;
    } else {
      line.waiting++;
      waiting++;
    }
  }
  return {
    waiting,
    told,
    lines: [...lines.values()].sort((a, b) => b.waiting - a.waiting || a.subject.localeCompare(b.subject) || a.gradeLevel.localeCompare(b.gradeLevel)),
  };
}
