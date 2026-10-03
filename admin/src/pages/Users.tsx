import React, { useEffect, useState } from 'react';
import { Loader2, Search, Ban } from 'lucide-react';
import { fetchUsers, banUser } from '../lib/queries';
import { useAdminAuth } from '../lib/AuthContext';
import { AdminUserRow } from '../types';

export const Users: React.FC = () => {
  const { adminProfile } = useAdminAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [banningId, setBanningId] = useState<string | null>(null);

  const load = (term: string) => {
    setIsLoading(true);
    fetchUsers(term).then(setUsers).catch(() => setUsers([])).finally(() => setIsLoading(false));
  };

  useEffect(() => { load(''); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(search);
  };

  const handleBan = async (userId: string) => {
    if (!adminProfile) return;
    const reason = window.prompt('Reason for banning this user (logged to audit trail):');
    if (!reason) return;
    setBanningId(userId);
    try {
      await banUser(userId, adminProfile.id, reason);
    } finally {
      setBanningId(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-6">Users</h1>

      <form onSubmit={handleSearch} className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full bg-white border border-slate-200 text-sm font-semibold text-[#0F172A] rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer">
          Search
        </button>
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading users…</span>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {users.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#0F172A]">{u.fullName}</span>
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">{u.role}</span>
                  {u.role === 'tutor' && u.isVerifiedTutor && (
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Verified</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{u.email} · joined {new Date(u.createdAt).toLocaleDateString()}</p>
              </div>
              <button
                onClick={() => handleBan(u.id)}
                disabled={banningId === u.id}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl cursor-pointer disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                Ban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
