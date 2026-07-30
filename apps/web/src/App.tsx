import React from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { AppShell } from './components/layout/AppShell';

/* ═══════════════════════════════════════════════════════════
   Main App Controller
   Auth Gate: If authenticated -> AppShell, else -> LoginPage
   ═══════════════════════════════════════════════════════════ */

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">
            Loading ESIC HMS...
          </p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <AppShell /> : <LoginPage />;
};

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
