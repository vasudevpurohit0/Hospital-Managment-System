import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './components/layout/AppShell';
import { PlatformConsole } from './components/layout/PlatformConsole';

/* ═══════════════════════════════════════════════════════════
   Main App Controller
   Auth Gate:
     not authenticated            -> LoginPage (one unified form for everyone)
     platform mode, no hospital   -> PlatformConsole
     otherwise (hospital staff,
       or platform mode with a
       hospital entered)          -> AppShell (unmodified, reused)
   ═══════════════════════════════════════════════════════════ */

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, mode, activeHospital } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">
            Loading AYUSH SARATHI...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
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
