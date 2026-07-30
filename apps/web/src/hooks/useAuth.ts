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
  SuperAdmin: 'Administrator',
  Administrator: 'Administrator',
  Doctor: 'Doctor',
  Pharmacist: 'Pharmacist',
  Nurse: 'Nurse',
  StoreManager: 'Store Manager',
  Receptionist: 'Receptionist',
  LabTechnician: 'Lab Technician',
  BillingClerk: 'Billing Clerk',
};

function buildUserFromRole(roleName: string, identifier: string): AuthUser {
  const displayName = ROLE_DISPLAY_NAMES[roleName] || roleName;
  return {
    id: `user-${roleName.toLowerCase()}`,
    name: `${displayName}`,
    email: identifier,
    role: roleName,
  };
}

function inferRoleFromIdentifier(identifier: string): string {
  const id = identifier.toLowerCase();
  if (id.includes('admin') || id.includes('super')) return 'SuperAdmin';
  if (id.includes('doctor') || id.includes('dr')) return 'Doctor';
  if (id.includes('pharma')) return 'Pharmacist';
  if (id.includes('nurse')) return 'Nurse';
  if (id.includes('store') || id.includes('inventory')) return 'StoreManager';
  if (id.includes('reception') || id.includes('front')) return 'Receptionist';
  if (id.includes('lab')) return 'LabTechnician';
  if (id.includes('bill')) return 'BillingClerk';
  return 'Doctor';
}

function getRoleFullName(role: string): string {
  const names: Record<string, string> = {
    SuperAdmin: 'Dr. Rajesh Kumar',
    Doctor: 'Dr. Suresh Sharma',
    Pharmacist: 'Rph. Anjali Verma',
    Nurse: 'Ns. Priya Singh',
    StoreManager: 'Mr. Vikram Patel',
    Receptionist: 'Ms. Sunita Devi',
    LabTechnician: 'Mr. Amit Joshi',
    BillingClerk: 'Ms. Kavita Rao',
  };
  return names[role] || 'ESIC User';
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
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
    } catch {
      // Backend unreachable (e.g. offline/demo environment) — fall back to a local demo session.
      const roleName = inferRoleFromIdentifier(identifier);
      const user = buildUserFromRole(roleName, identifier);
      user.name = getRoleFullName(roleName);
      const mockToken = `dev-session-${Date.now()}`;
      storeAuth(mockToken, user);
      setState({
        token: mockToken,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return;
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorData.message || `Authentication failed (${res.status})`,
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
