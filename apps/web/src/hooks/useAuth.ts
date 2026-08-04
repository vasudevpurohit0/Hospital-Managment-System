import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const AUTH_STORAGE_KEY = 'esic-hms-auth';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

interface StoredAuth {
  token: string;
  user: AuthUser;
  expiresAt: number;
}

function getStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const stored: StoredAuth = JSON.parse(raw);
    if (Date.now() > stored.expiresAt) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function storeAuth(token: string, user: AuthUser): void {
  const stored: StoredAuth = {
    token,
    user,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
}

function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  SuperAdmin: 'Super Admin',
  Administrator: 'Administrator',
  Doctor: 'Doctor',
  Pharmacist: 'Pharmacist',
  Nurse: 'Nurse',
  StoreManager: 'Store Manager',
  ProcurementOfficer: 'Procurement Officer',
  Reception: 'Reception',
  AdmissionDesk: 'Admission Desk',
  DataEntryOperator: 'Data Entry Operator',
};

function buildUserFromRole(roleName: string, identifier: string): AuthUser {
  const displayName = ROLE_DISPLAY_NAMES[roleName] || roleName;
  return {
    id: `user-${roleName.toLowerCase()}`,
    name: displayName,
    email: identifier,
    role: roleName,
  };
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(() => {
    const stored = getStoredAuth();
    if (stored) {
      return {
        token: stored.token,
        user: stored.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    }
    return {
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    };
  });

  const login = useCallback(async (identifier: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    let res: Response;
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const primaryUrl = `${baseUrl}/api/auth/login`;

    try {
      try {
        res = await fetch(primaryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        });
      } catch {
        res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        });
      }
    } catch {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Unable to connect to the server. Please make sure the backend is running.',
      }));
      return;
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage =
        errorData.message ||
        (res.status === 503
          ? 'Unable to connect to the server. Please start the backend API.'
          : res.status === 500
            ? 'Internal server error occurred on the backend API.'
            : `Authentication failed (${res.status})`);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage,
      }));
      return;
    }

    const data = await res.json();
    const token = data.accessToken;
    const roleName = data.user?.role || data.role || 'Doctor';
    const user = buildUserFromRole(roleName, identifier);

    if (data.user?.name) user.name = data.user.name;
    if (data.user?.id) user.id = data.user.id;
    if (data.user?.department) user.department = data.user.department;

    storeAuth(token, user);
    setState({
      token,
      user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const stored = getStoredAuth();
      if (!stored && state.isAuthenticated) {
        logout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [state.isAuthenticated, logout]);

  return React.createElement(
    AuthContext.Provider,
    { value: { ...state, login, logout, clearError } },
    children,
  );
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
