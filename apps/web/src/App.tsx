import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './components/layout/AppShell';
import { PlatformConsole } from './components/layout/PlatformConsole';
import { ForcedChangePasswordScreen } from './pages/auth/ForcedChangePasswordScreen';
import { ActivateAccountPage } from './pages/auth/ActivateAccountPage';

/* ═══════════════════════════════════════════════════════════
   Main App Controller
   Auth Gate:
     /activate?token=...          -> ActivateAccountPage (reachable with no
                                      session at all -- the activation token
                                      itself is the credential)
     not authenticated            -> LoginPage (one unified form for everyone)
     hospital staff, must change
       password (first login or
       an admin-triggered reset)  -> ForcedChangePasswordScreen
     platform mode, no hospital   -> PlatformConsole
     otherwise (hospital staff,
       or platform mode with a
       hospital entered)          -> AppShell (unmodified, reused)
   ═══════════════════════════════════════════════════════════ */

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, mode, activeHospital, user } = useAuth();

  // Reachable with no auth token at all -- the activation link's token is
  // the credential, same reasoning as LoginPage needing no prior session.
  if (window.location.pathname === '/activate') {
    return <ActivateAccountPage />;
  }

  // LoginPage owns its own in-flight UI (the submit button spinner), so it must
  // stay mounted while a login request is running. isLoading is only ever true
  // during that request -- the session restore is synchronous in useAuth's
  // useState initialiser -- so gating the splash above this line unmounted the
  // form on every submit and wiped whatever the user had typed.
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">
            Loading AAYUSH SAARTHI...
          </p>
        </div>
      </div>
    );
  }

  if (mode === 'hospital' && user?.mustChangePassword) {
    return <ForcedChangePasswordScreen />;
  }

  if (mode === 'platform' && !activeHospital) {
    return <PlatformConsole />;
  }

  return <AppShell />;
};

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
