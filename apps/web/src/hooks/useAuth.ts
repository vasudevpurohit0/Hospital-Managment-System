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
  /**
   * The actor who started the whole chain (e.g. a Super Admin), present only
   * from the second hop onward -- a Super Admin impersonating a Hospital
   * Admin who then impersonates a Doctor. Absent on a single-level session,
   * where `impersonatorRoleName`/`impersonatorIdentifier` above already are
   * the root. Mirrors the backend's ImpersonationClaims.root.
   */
  root?: { roleName: string; identifier: string };
}

/**
 * The session being returned to on "Exit Impersonation". Recursive: when
 * `impersonation` is present here, the session itself was mid-impersonation
 * (a chained hop), so exiting restores both this session AND its own
 * impersonation banner/state, rather than dropping straight to a fully
 * unimpersonated session no matter how deep the chain was.
 */
interface OriginalSession {
  /** null for a normal (cookie-authenticated) session -- see A-02 note on AuthState.token below. Only ever a real string here for a nested impersonation hop's immediate parent, which is itself another impersonation token. */
  token: string | null;
  /** The root's own double-submit CSRF value (see AuthState.csrfToken) -- needed so logout() can still pass CSRF when revoking a cookie-only root session while several impersonation hops deep. */
  csrfToken: string | null;
  user: AuthUser;
  mode: AuthMode;
  activeHospital: ActiveHospital | null;
  impersonation?: StoredImpersonation;
}

interface StoredImpersonation {
  info: ImpersonationInfo;
  original: OriginalSession;
}

interface AuthState {
  /**
   * A-02 (2026-09-22 audit): null for a normal session -- the access token
   * lives ONLY in the httpOnly cookie the backend sets on login, never
   * handed to JS, so it can't be exfiltrated via XSS/localStorage the way it
   * could before. Still a real string during impersonation (see
   * startImpersonation()): impersonation tokens are Authorization-header-only
   * by design (no cookie is ever set for them, and they carry no CSRF
   * claim), so the client still needs to hold and send that one explicitly.
   */
  token: string | null;
  /** The current session's double-submit CSRF value, returned once by the login/refresh response body -- see client.ts's getStoredCsrfToken(). Always null during impersonation (impersonation tokens carry no csrf claim; Authorization-header auth doesn't need one -- see security.middleware.ts). */
  csrfToken: string | null;
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
  /** null for a normal session -- see AuthState.token. */
  token: string | null;
  csrfToken: string | null;
  user: AuthUser;
  expiresAt: number;
  activeHospital?: ActiveHospital | null;
  /** Present only while impersonating -- carries both who's impersonating and the original session to restore on exit. */
  impersonation?: StoredImpersonation;
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
  token: string | null,
  csrfToken: string | null,
  user: AuthUser,
  activeHospital: ActiveHospital | null = null,
  impersonation: StoredAuth['impersonation'] = undefined,
): void {
  const stored: StoredAuth = {
    mode,
    token,
    csrfToken,
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
      credentials: 'include',
      body: JSON.stringify(body),
    });
  } catch {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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
        csrfToken: stored.csrfToken ?? null,
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
      csrfToken: null,
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
    const mode: AuthMode = data.mode === 'platform' ? 'platform' : 'hospital';
    // A-02: the real access token now lives ONLY in the httpOnly cookie the
    // login response's Set-Cookie already established -- never stored here,
    // so a successful XSS can no longer read it out of localStorage. Only
    // the one-time CSRF value (meaningless without the cookie it pairs
    // with) is kept, for double-submit verification on mutating requests.
    const csrfToken: string | null = data.csrfToken ?? null;

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

    storeAuth(mode, null, csrfToken, user, null);
    setState({
      token: null,
      csrfToken,
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
    // For a chained session (Super Admin -> Hospital Admin -> Doctor), the
    // one real, persistent login is at the BOTTOM of the `original` chain --
    // every level above the deepest one is itself just another short-lived
    // impersonation token, not a session with its own tokenVersion to
    // revoke -- so this walks all the way down rather than stopping at the
    // immediate parent.
    const stored = getStoredAuth();
    if (stored?.impersonation) {
      let root = stored.impersonation.original;
      while (root.impersonation) {
        root = root.impersonation.original;
      }
      apiFetch('/api/auth/exit-impersonation', { method: 'POST' }).catch(() => undefined);
      // root.token is null when the root session was itself cookie-only
      // (the normal case since A-02) -- that's fine, apiFetch then relies on
      // the root's own httpOnly cookie, which impersonation never touched or
      // overwrote. But that path needs the ROOT's own CSRF value explicitly
      // (the currently-stored one belongs to the impersonation session, not
      // the root, and impersonation sessions carry none anyway), so it's
      // passed as an explicit header rather than left to apiFetch's usual
      // auto-lookup.
      apiFetch(
        '/api/auth/logout',
        { method: 'POST', headers: root.csrfToken ? { 'X-CSRF-Token': root.csrfToken } : {} },
        root.token,
      ).catch(() => undefined);
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
      csrfToken: null,
      user: null,
      mode: null,
      activeHospital: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      impersonation: null,
    });
  }, []);

  /**
   * Starts (or extends) an impersonation session. Whether this is a fresh
   * level-1 impersonation or one hop deeper into an existing chain (Super
   * Admin -> Hospital Admin -> Doctor), the server has already decided
   * eligibility server-side (see AccountLifecycleService.impersonate) by the
   * time this is called -- the client never re-derives or enforces that
   * chain rule itself, it just needs to stash whatever session it's leaving
   * so `exitImpersonation` can unwind one level at a time.
   */
  const startImpersonation = useCallback((accessToken: string, target: ImpersonationTarget) => {
    setState((prev) => {
      // A-02: a normal session's prev.token is null by design (cookie-only)
      // -- token presence is no longer a valid "is this a real session"
      // signal, so this guards on user/mode instead, same as
      // enterHospital/exitHospital/clearMustChangePassword below.
      if (!prev.user || !prev.mode) return prev;
      const targetUser = buildUserFromRole(target.role, target.identifier);
      targetUser.id = target.id;
      if (target.name) targetUser.name = target.name;

      // When already impersonating, the chain's root is whatever the
      // CURRENT impersonation says it is (or, on the first hop being
      // extended, the current impersonator itself) -- never the caller
      // (`prev.user`) below, which is only ever the immediate parent.
      const root = prev.impersonation
        ? (prev.impersonation.root ?? {
            roleName: prev.impersonation.impersonatorRoleName,
            identifier: prev.impersonation.impersonatorIdentifier,
          })
        : undefined;

      const info: ImpersonationInfo = {
        active: true,
        impersonatorRoleName: prev.user.role,
        impersonatorIdentifier: prev.user.email,
        root,
      };

      // Whatever is currently persisted as this session's own impersonation
      // state (if `prev` was itself mid-impersonation) is carried forward
      // wholesale as the new session's nested `original.impersonation` --
      // this is what turns single "restore the original" into a real stack:
      // each level's `original` points at the level below it, chain and all.
      const currentlyStored = getStoredAuth();
      const original: OriginalSession = {
        token: prev.token,
        csrfToken: prev.csrfToken,
        user: prev.user,
        mode: prev.mode,
        activeHospital: prev.activeHospital,
        impersonation: prev.impersonation ? currentlyStored?.impersonation : undefined,
      };

      // Impersonation tokens carry no csrf claim (auth.service.ts) and are
      // Authorization-header-only by design -- no cookie is ever set for
      // them, so there's nothing to double-submit-protect.
      storeAuth('hospital', accessToken, null, targetUser, prev.activeHospital, { info, original });
      return { ...prev, token: accessToken, csrfToken: null, user: targetUser, mode: 'hospital', impersonation: info };
    });
  }, []);

  /**
   * Ends the CURRENT (deepest) impersonation hop only, restoring the level
   * directly beneath it -- which may itself still be an impersonation (e.g.
   * Doctor -> Hospital Admin, still impersonating), not necessarily the
   * original real actor. Calling this repeatedly walks back up the chain one
   * level at a time, matching how it was built.
   */
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
      storeAuth(saved.mode, saved.token, saved.csrfToken, saved.user, saved.activeHospital, saved.impersonation);
      return {
        token: saved.token,
        csrfToken: saved.csrfToken,
        user: saved.user,
        mode: saved.mode,
        activeHospital: saved.activeHospital,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        impersonation: saved.impersonation?.info ?? null,
      };
    });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const enterHospital = useCallback((hospital: ActiveHospital) => {
    setState((prev) => {
      // A-02: token is null for a normal session by design -- guard on
      // user/mode instead (see startImpersonation's identical note).
      if (!prev.user || prev.mode !== 'platform') return prev;
      storeAuth('platform', prev.token, prev.csrfToken, prev.user, hospital);
      return { ...prev, activeHospital: hospital };
    });
  }, []);

  const exitHospital = useCallback(() => {
    setState((prev) => {
      if (!prev.user || prev.mode !== 'platform') return prev;
      storeAuth('platform', prev.token, prev.csrfToken, prev.user, null);
      return { ...prev, activeHospital: null };
    });
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setState((prev) => {
      if (!prev.user || !prev.mode) return prev;
      const updatedUser = { ...prev.user, mustChangePassword: false };
      storeAuth(prev.mode, prev.token, prev.csrfToken, updatedUser, prev.activeHospital);
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
