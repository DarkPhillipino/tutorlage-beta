import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Users, Banknote, Settings, ScrollText, LogOut, BarChart3 } from 'lucide-react';
import { useAdminAuth } from '../lib/AuthContext';
import { AdminRole } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  // Roles that see this in the nav. RLS is the real enforcement — this is
  // just "don't show a super_admin-only screen to a support_agent," not a
  // security boundary. See CLAUDE.md's note on role-based nav vs role-based RLS.
  roles: AdminRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/verification', label: 'Tutor Verification', icon: ShieldCheck, roles: ['verification_officer', 'super_admin'] },
  { to: '/disputes', label: 'Disputes', icon: AlertTriangle, roles: ['support_agent', 'super_admin'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['support_agent', 'verification_officer', 'super_admin'] },
  { to: '/payouts', label: 'Payments', icon: Banknote, roles: ['finance_manager', 'super_admin'] },
  { to: '/settings', label: 'System Settings', icon: Settings, roles: ['super_admin'] },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText, roles: ['support_agent', 'verification_officer', 'finance_manager', 'super_admin'] },
  { to: '/phase-1', label: 'Phase 1 Numbers', icon: BarChart3, roles: ['support_agent', 'verification_officer', 'finance_manager', 'super_admin'] },
];

export const AdminLayout: React.FC = () => {
  const { adminProfile, signOut } = useAdminAuth();
  const visibleItems = NAV_ITEMS.filter((item) => adminProfile && item.roles.includes(adminProfile.adminRole));

  return (
    <div className="min-h-screen flex bg-[#FAF7F2] text-[#0F172A] font-sans">
      <aside className="w-60 shrink-0 bg-[#0A192F] text-white flex flex-col">
        <div className="p-5 border-b border-slate-800">
          <div className="text-lg font-extrabold tracking-tight">Tutorlage</div>
          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Admin</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isActive ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <div className="px-3 py-2 mb-1">
            <div className="text-xs font-bold truncate">{adminProfile?.fullName}</div>
            <div className="text-[10px] text-slate-400 capitalize">{adminProfile?.adminRole.replace(/_/g, ' ')}</div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};
