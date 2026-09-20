import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../api/client';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
  /** Present for a hospital-staff session; absent for a platform session. */
  hospitalId?: string;
  /** True until the doctor completes a forced first-login (or post-reset) password change. Platform/Super Admin sessions never carry this. */
  mustChangePassword?: boolean;
}

export type AuthMode = 'hospital' | 'platform';

export interface ActiveHospital {
  id: string;
  name: string;
}

/** Who is really behind the wheel right now -- kept even while `user`/`token` above are the impersonated target's, so the banner and "Exit Impersonation" never have to guess. */
export interface ImpersonationInfo {
  active: true;
  impersonatorRoleName: string;
  impersonatorIdentifier: string;
}

interface OriginalSession {
  token: string;
  user: AuthUser;
  mode: AuthMode;
  activeHospital: ActiveHospital | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  mode: AuthMode | null;
  activeHospital: ActiveHospital | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  impersonation: ImpersonationInfo | null;
}

export interface ImpersonationTarget {
  id: string;
  identifier: string;
  role: string;
  name?: string;
}

interface AuthContextType extends AuthState {
  /** One unified login for everyone -- the backend resolves hospital vs. platform from the identifier alone. */
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  /** Super Admin "enters" a hospital: every subsequent request carries X-Hospital-Id. */
  enterHospital: (hospital: ActiveHospital) => void;
  /** Returns to the platform console, no hospital selected. */
  exitHospital: () => void;
  /** Called once a forced password change succeeds, so the app stops gating on it for the rest of this session. */
  clearMustChangePassword: () => void;
  /**
   * Switches the active session to an impersonation token the backend just
   * issued (via POST /staff|doctors/:id/impersonate) -- the real
   * administrator's own session is stashed, not discarded, so
   * exitImpersonation() below can restore it with no re-login. This never
   * itself grants any permission: the token's effective permissions were
   * already decided server-side (see AccountLifecycleService.impersonate).
   */
  startImpersonation: (accessToken: string, target: ImpersonationTarget) => void;
  /** Ends the current impersonation session: audits the end server-side (best-effort) and restores the original administrator's own session, already held locally. */
  exitImpersonation: () => void;
}

const AUTH_STORAGE_KEY = 'esic-hms-auth';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

interface StoredAuth {
  mode: AuthMode;
  token: string;
  user: AuthUser;
  expiresAt: number;
  activeHospital?: ActiveHospital | null;
  /** Present only while impersonating -- carries both who's impersonating and the original session to restore on exit. */
  impersonation?: {
    info: ImpersonationInfo;
    original: OriginalSession;
  };
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
    // Old (pre-multi-hospital) sessions have no `mode` -- treat as expired
    // rather than guessing, so the user just logs in again.
    if (!stored.mode) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function storeAuth(
  mode: AuthMode,
  token: string,
  user: AuthUser,
  activeHospital: ActiveHospital | null = null,
  impersonation: StoredAuth['impersonation'] = undefined,
): void {
  const stored: StoredAuth = {
    mode,
    token,
    user,
    expiresAt: Date.now() + SESSION_DURATION_MS,
    activeHospital,
    impersonation,
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
}

function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  Administrator: 'Administrator',
  Doctor: 'Doctor',
  Pharmacist: 'Pharmacist',
  Nurse: 'Nurse',
  StoreManager: 'Store Manager',
  ProcurementOfficer: 'Procurement Officer',
  Reception: 'Reception',
  AdmissionDesk: 'Admission Desk',
  DataEntryOperator: 'Data Entry Operator',
  QueueManager: 'Queue Manager',
  LabTechnician: 'Lab Technician',
  Pathologist: 'Pathologist',
  Accountant: 'Accountant',
  OPDDisplayOperator: 'OPD Display Operator',
  THERAPY_STAFF: 'Therapy / Panchakarma Staff',
};

function buildUserFromRole(roleName: string, identifier: string, hospitalId?: string): AuthUser {
  const displayName = ROLE_DISPLAY_NAMES[roleName] || roleName;
  return {
    id: `user-${roleName.toLowerCase()}`,
    name: displayName,
    email: identifier,
    role: roleName,
    hospitalId,
  };
}

function baseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

async function postJson(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(() => {
    const stored = getStoredAuth();
    if (stored) {
      return {
        token: stored.token,
        user: stored.user,
        mode: stored.mode,
        activeHospital: stored.activeHospital || null,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        // A page refresh mid-impersonation must not lose it -- the whole
        // point of persisting `impersonation` (info + the stashed original
        // session) in the same localStorage blob as everything else.
        impersonation: stored.impersonation?.info || null,
      };
    }
    return {
      token: null,
      user: null,
      mode: null,
      activeHospital: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      impersonation: null,
    };
  });

  const login = useCallback(async (identifier: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    let res: Response;
    try {
      res = await postJson('/api/auth/login', { identifier, password });
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
    const mode: AuthMode = data.mode === 'platform' ? 'platform' : 'hospital';

    let user: AuthUser;
    if (mode === 'platform') {
      user = {
        id: data.user?.id || 'platform-user',
        name: data.user?.name || 'Super Admin',
        email: data.user?.email || identifier,
        role: 'SuperAdmin',
      };
    } else {
      const roleName = data.user?.role;
      if (!roleName) {
        // The backend always sends `user.role` on a successful hospital
        // login; if it's ever missing, silently treating this person as a
        // Doctor would hand them that role's menu and workspace instead of
        // surfacing the real problem.
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Login succeeded but the server response was missing role information. Please contact support.',
        }));
        return;
      }
      user = buildUserFromRole(roleName, identifier);
      if (data.user?.name) user.name = data.user.name;
      if (data.user?.id) user.id = data.user.id;
      if (data.user?.department) user.department = data.user.department;
      user.mustChangePassword = !!data.mustChangePassword;
    }

    storeAuth(mode, token, user, null);
    setState({
      token,
      user,
      mode,
      activeHospital: null,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      impersonation: null,
    });
  }, []);

  const logout = useCallback(() => {
    // Impersonating: a plain logout must revoke the REAL administrator's own
    // session, never the impersonated target's (which the impersonation
    // token's `sub` actually is) -- otherwise clicking "Log out" while
    // impersonating a nurse would silently bump that nurse's own
    // tokenVersion and kill their unrelated real sessions. exitToken is an
    // explicit token override apiFetch already supports for exactly this.
    const stored = getStoredAuth();
    if (stored?.impersonation) {
      apiFetch('/api/auth/exit-impersonation', { method: 'POST' }).catch(() => undefined);
      apiFetch('/api/auth/logout', { method: 'POST' }, stored.impersonation.original.token).catch(() => undefined);
    } else {
      // V-02: best-effort -- revokes the session server-side (bumps
      // tokenVersion, invalidating every outstanding access/refresh token
      // for this user) before dropping local state. Fired without awaiting
      // so a slow/unreachable backend never blocks the user from logging
      // out locally; if it fails, the token simply expires on its own later.
      apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    }
    clearStoredAuth();
    setState({
      token: null,
      user: null,
      mode: null,
      activeHospital: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      impersonation: null,
    });
  }, []);

  const startImpersonation = useCallback((accessToken: string, target: ImpersonationTarget) => {
    setState((prev) => {
      if (!prev.token || !prev.user || !prev.mode || prev.impersonation) return prev; // no nested impersonation, client-side mirror of the server-side guard
      const targetUser = buildUserFromRole(target.role, target.identifier);
      targetUser.id = target.id;
      if (target.name) targetUser.name = target.name;

      const info: ImpersonationInfo = {
        active: true,
        impersonatorRoleName: prev.user.role,
        impersonatorIdentifier: prev.user.email,
      };
      const original: OriginalSession = {
        token: prev.token,
        user: prev.user,
        mode: prev.mode,
        activeHospital: prev.activeHospital,
      };

      storeAuth('hospital', accessToken, targetUser, prev.activeHospital, { info, original });
      return { ...prev, token: accessToken, user: targetUser, mode: 'hospital', impersonation: info };
    });
  }, []);

  const exitImpersonation = useCallback(() => {
    // Ends the session server-side (an audit event -- see
    // AuthService.endImpersonation) before dropping it locally. Best-effort:
    // even if this fails (network blip), the admin must still get their own
    // account back, which is a purely local restore of a session they
    // already legitimately held -- never something the server needs to
    // re-grant.
    apiFetch('/api/auth/exit-impersonation', { method: 'POST' }).catch(() => undefined);
    setState((prev) => {
      const stored = getStoredAuth();
      const saved = stored?.impersonation?.original;
      if (!saved) return prev;
      storeAuth(saved.mode, saved.token, saved.user, saved.activeHospital);
      return {
        token: saved.token,
        user: saved.user,
        mode: saved.mode,
        activeHospital: saved.activeHospital,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        impersonation: null,
      };
    });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const enterHospital = useCallback((hospital: ActiveHospital) => {
    setState((prev) => {
      if (!prev.token || !prev.user || prev.mode !== 'platform') return prev;
      storeAuth('platform', prev.token, prev.user, hospital);
      return { ...prev, activeHospital: hospital };
    });
  }, []);

  const exitHospital = useCallback(() => {
    setState((prev) => {
      if (!prev.token || !prev.user || prev.mode !== 'platform') return prev;
      storeAuth('platform', prev.token, prev.user, null);
      return { ...prev, activeHospital: null };
    });
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setState((prev) => {
      if (!prev.token || !prev.user || !prev.mode) return prev;
      const updatedUser = { ...prev.user, mustChangePassword: false };
      storeAuth(prev.mode, prev.token, updatedUser, prev.activeHospital);
      return { ...prev, user: updatedUser };
    });
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
    {
      value: {
        ...state,
        login,
        logout,
        clearError,
        enterHospital,
        exitHospital,
        clearMustChangePassword,
        startImpersonation,
        exitImpersonation,
      },
    },
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
