import React from 'react';
import { GraduationCap, MapPin, ShieldCheck, Repeat } from 'lucide-react';

const PILLARS = [
  {
    icon: MapPin,
    title: 'Hyper-local matching',
    body: 'Geospatial matching connects students with tutors close to their own institution, for both in-person and online sessions.',
  },
  {
    icon: GraduationCap,
    title: 'Structured scheduling',
    body: 'Book a session now or schedule ahead, at a subject, grade level, and pricing tier that fits.',
  },
  {
    icon: ShieldCheck,
    title: 'Strict verification',
    body: 'Every tutor goes through document verification before they can accept sessions — safety first, not an afterthought.',
  },
  {
    icon: Repeat,
    title: 'A circular academic economy',
    body: 'Recent high school graduates and top students monetize their own academic success, while families get affordable, relatable peer mentoring.',
  },
];

export const AboutPage: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="bg-white rounded-2xl p-6 sm:p-10 shadow-sm border border-slate-200/80">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0F172A] tracking-tight mb-4">
          About Tutorlage
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-8">
          Tutorlage is an on-demand academic tutoring platform designed to connect parents and students
          with top-performing matriculants and local tutors, for both in-person and online sessions.
          It creates a circular academic economy: recent high school graduates and top students earn
          from their own academic success, while families get affordable, relatable peer mentoring.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-[#FAF7F2] rounded-2xl p-5 border border-slate-200/60">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-3">
                <p.icon className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A] mb-1">{p.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
