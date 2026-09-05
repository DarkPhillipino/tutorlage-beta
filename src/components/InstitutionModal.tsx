import React, { useEffect, useState } from 'react';
import { X, Search, Building, Check, Loader2, AlertTriangle } from 'lucide-react';
import { Institution } from '../types';
import { fetchInstitutions } from '../lib/queries';

interface InstitutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentInstitution: string;
  onSelectInstitution: (institutionName: string) => void;
}

export const InstitutionModal: React.FC<InstitutionModalProps> = ({
  isOpen,
  onClose,
  currentInstitution,
  onSelectInstitution,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setLoadError(false);
    fetchInstitutions()
      .then(setInstitutions)
      .catch((err) => {
        console.error('fetchInstitutions failed:', err);
        setInstitutions([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, retryCount]);

  if (!isOpen) return null;

  const filtered = institutions.filter(inst =>
    inst.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-lg w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className="p-6 bg-[#0A192F] text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <h3 className="text-xl font-extrabold tracking-tight">Select Institution</h3>
            <p className="text-xs text-slate-300 mt-1">
              Choose your university, college, or school campus
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 bg-[#FAF7F2] border-b border-slate-200">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search institution or campus city..."
              className="w-full bg-white text-[#0F172A] placeholder-slate-400 text-sm font-semibold pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20"
            />
          </div>
        </div>

        {/* Institutions List */}
        <div className="p-4 overflow-y-auto max-h-[50vh] space-y-2 bg-[#FAF7F2]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm font-semibold">Loading institutions…</span>
            </div>
          ) : loadError ? (
            <div className="text-center py-10 px-4">
              <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-[#0F172A]">Couldn't load institutions</p>
              <p className="text-xs text-slate-500 mt-1">Check your connection and try again.</p>
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="mt-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Building className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-[#0F172A]">No institutions found</p>
              <p className="text-xs text-slate-500 mt-1">
                {institutions.length === 0
                  ? 'No institutions have been added yet — check back soon.'
                  : 'Try a different search term.'}
              </p>
            </div>
          ) : (
            filtered.map((inst) => {
              const isSelected = inst.name === currentInstitution;
              return (
                <button
                  key={inst.id}
                  onClick={() => {
                    onSelectInstitution(inst.name);
                    onClose();
                  }}
                  className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-white border-[#15803D] ring-2 ring-[#15803D]/20 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div className={`p-2.5 rounded-xl shrink-0 ${isSelected ? 'bg-emerald-100 text-[#15803D]' : 'bg-slate-100 text-slate-600'}`}>
                      <Building className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#0F172A]">{inst.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span>{inst.institutionType}</span>
                        <span className="text-slate-400 ml-2">• {inst.curriculum}</span>
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-[#15803D] text-white flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
};
