import React, { useState } from 'react';
import { LogOut, Building2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { PlatformDashboardScreen } from '../../screens/platform/PlatformDashboardScreen';
import { HospitalsListScreen } from '../../screens/platform/HospitalsListScreen';
import { CreateHospitalScreen } from '../../screens/platform/CreateHospitalScreen';
import { PlatformAdminsScreen } from '../../screens/platform/PlatformAdminsScreen';
import { PlatformAuditLogScreen } from '../../screens/platform/PlatformAuditLogScreen';

type PlatformPage = 'dashboard' | 'hospitals' | 'create-hospital' | 'admins' | 'audit-log';

const TABS: { id: PlatformPage; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'hospitals', label: 'Hospitals' },
  { id: 'admins', label: 'Platform Admins' },
  { id: 'audit-log', label: 'Audit Log' },
];

/**
 * The Super Admin's landing area before entering a specific hospital.
 * Intentionally minimal (no Sidebar/TopNav reuse) -- once a hospital is
 * entered, useAuth().activeHospital being set routes AppContent to the
 * existing AppShell instead, so all the real clinical screens are reused
 * unmodified.
 */
export const PlatformConsole: React.FC = () => {
  const { user, logout } = useAuth();
  const [page, setPage] = useState<PlatformPage>('dashboard');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0B2545] text-white">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-amber-300" />
            <div>
              <p className="text-sm font-bold leading-tight">Platform Console</p>
              <p className="text-[11px] text-blue-200/80 leading-tight">Super Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-blue-200/80">{user?.email}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-xs font-semibold text-white/90 hover:text-white bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg transition-all"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPage(tab.id)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
                page === tab.id || (page === 'create-hospital' && tab.id === 'hospitals')
                  ? 'border-amber-400 text-white'
                  : 'border-transparent text-blue-200/70 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {page === 'dashboard' && <PlatformDashboardScreen />}
        {page === 'hospitals' && <HospitalsListScreen onCreateHospital={() => setPage('create-hospital')} />}
        {page === 'create-hospital' && (
          <CreateHospitalScreen onCreated={() => setPage('hospitals')} onCancel={() => setPage('hospitals')} />
        )}
        {page === 'admins' && <PlatformAdminsScreen />}
        {page === 'audit-log' && <PlatformAuditLogScreen />}
      </main>
    </div>
  );
};
