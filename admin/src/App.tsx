import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAdmin } from './components/RequireAdmin';
import { AdminLayout } from './components/AdminLayout';
import { Login } from './pages/Login';
import { TutorVerificationQueue } from './pages/TutorVerificationQueue';
import { TutorVerificationDetail } from './pages/TutorVerificationDetail';
import { Disputes } from './pages/Disputes';
import { Users } from './pages/Users';
import { Payouts } from './pages/Payouts';
import { SystemSettingsPage } from './pages/SystemSettings';
import { AuditLog } from './pages/AuditLog';
import { Phase1Numbers } from './pages/Phase1Numbers';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="/verification" replace />} />
        <Route path="verification" element={<TutorVerificationQueue />} />
        <Route path="verification/:tutorId" element={<TutorVerificationDetail />} />
        <Route path="disputes" element={<Disputes />} />
        <Route path="users" element={<Users />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="settings" element={<SystemSettingsPage />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="phase-1" element={<Phase1Numbers />} />
      </Route>
    </Routes>
  );
}
