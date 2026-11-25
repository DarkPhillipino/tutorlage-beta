import React from 'react';

// The two choices on a tutor's booking path, and no others (PM line 79 C): nobody is offered a tutor account here.
export type BookingRole = 'parent' | 'student';

const CHOICES: { role: BookingRole; label: string }[] = [
  { role: 'parent', label: 'Parent or guardian' },
  { role: 'student', label: 'Learner' },
];

export function LinkRolePicker({ value, onChange, describedBy }: { value: BookingRole | null; onChange: (role: BookingRole) => void; describedBy?: string }) {
  return (
    <div role="group" aria-label="I am a" aria-describedby={describedBy} className="grid grid-cols-2 gap-2" data-role-picker>
      {CHOICES.map((c) => (
        <button
          key={c.role}
          type="button"
          aria-pressed={value === c.role}
          onClick={() => onChange(c.role)}
          className={`min-h-12 px-3 py-2.5 rounded-xl border text-sm font-bold cursor-pointer ${
            value === c.role ? 'bg-[#0F172A] border-[#0F172A] text-white' : 'bg-white border-slate-300 text-[#0F172A] hover:border-[#0F172A]'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
