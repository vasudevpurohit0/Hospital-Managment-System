import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../hooks/useAuth';

const AUTH_STORAGE_KEY = 'esic-hms-auth';

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function seedAdminSession() {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      mode: 'hospital',
      token: 'admin-token',
      user: { id: 'admin-1', name: 'Administrator', email: 'admin@esic.gov.in', role: 'Administrator' },
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      activeHospital: null,
    }),
  );
}

const nurseTarget = { id: 'nurse-1', identifier: 'nurse@esic.gov.in', role: 'Nurse', name: 'Target Nurse' };

describe('useAuth impersonation', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('swaps the active session to the target while stashing the original for later restore', () => {
    seedAdminSession();
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.startImpersonation('target-token', nurseTarget));

    expect(result.current.token).toBe('target-token');
    expect(result.current.user?.role).toBe('Nurse');
    expect(result.current.user?.id).toBe('nurse-1');
    expect(result.current.impersonation).toEqual({
      active: true,
      impersonatorRoleName: 'Administrator',
      impersonatorIdentifier: 'admin@esic.gov.in',
    });

    // Persisted, not just in-memory -- a refresh mid-impersonation must not lose it.
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
    expect(stored.token).toBe('target-token');
    expect(stored.impersonation.original.token).toBe('admin-token');
    expect(stored.impersonation.original.user.role).toBe('Administrator');
  });

  it('chains a second startImpersonation call into a nested session (server already decided eligibility -- the client never re-blocks this)', () => {
    seedAdminSession();
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.startImpersonation('admin-token-2', { id: 'admin-2', identifier: 'admin2@esic.gov.in', role: 'Administrator' }));
    act(() =>
      result.current.startImpersonation('doctor-token', { id: 'doc-1', identifier: 'doc@esic.gov.in', role: 'Doctor' }),
    );

    expect(result.current.token).toBe('doctor-token');
    expect(result.current.user?.role).toBe('Doctor');
    // The chain's root stays the FIRST impersonator throughout, not the
    // immediate parent (which is the level-1 Administrator target, itself
    // reached by impersonation).
    expect(result.current.impersonation).toEqual({
      active: true,
      impersonatorRoleName: 'Administrator',
      impersonatorIdentifier: 'admin2@esic.gov.in',
      root: { roleName: 'Administrator', identifier: 'admin@esic.gov.in' },
    });

    // Exiting once returns to the level-1 impersonation (still impersonating), not straight to the real original.
    act(() => result.current.exitImpersonation());
    expect(result.current.token).toBe('admin-token-2');
    expect(result.current.user?.role).toBe('Administrator');
    expect(result.current.impersonation).toEqual({
      active: true,
      impersonatorRoleName: 'Administrator',
      impersonatorIdentifier: 'admin@esic.gov.in',
    });

    // Exiting again returns all the way to the real original session.
    act(() => result.current.exitImpersonation());
    expect(result.current.token).toBe('admin-token');
    expect(result.current.user?.role).toBe('Administrator');
    expect(result.current.impersonation).toBeNull();
  });

  it('exitImpersonation restores the original administrator session with no re-login', () => {
    seedAdminSession();
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.startImpersonation('target-token', nurseTarget));
    act(() => result.current.exitImpersonation());

    expect(result.current.token).toBe('admin-token');
    expect(result.current.user?.role).toBe('Administrator');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.impersonation).toBeNull();

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const exitCall = calls.find((c) => String(c[0]).includes('/api/auth/exit-impersonation'));
    expect(exitCall).toBeDefined();
    expect((exitCall![1].headers as Record<string, string>).Authorization).toBe('Bearer target-token');
  });

  it('logout() while impersonating revokes the ORIGINAL administrator session, never the impersonated target\'s', () => {
    seedAdminSession();
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.startImpersonation('target-token', nurseTarget));
    act(() => result.current.logout());

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const logoutCall = calls.find((c) => String(c[0]).includes('/api/auth/logout'));
    expect(logoutCall).toBeDefined();
    // Explicitly the ORIGINAL admin's token, not whatever apiFetch would
    // have picked up from localStorage by default (which at call time is
    // still the impersonation token) -- this is the whole point of the
    // explicit-token override in useAuth's logout().
    expect((logoutCall![1].headers as Record<string, string>).Authorization).toBe('Bearer admin-token');

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.impersonation).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('persists impersonation state across a page refresh (re-reading localStorage on mount)', () => {
    seedAdminSession();
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.startImpersonation('target-token', nurseTarget));
    unmount();

    const { result: afterRefresh } = renderHook(() => useAuth(), { wrapper });
    expect(afterRefresh.current.token).toBe('target-token');
    expect(afterRefresh.current.user?.role).toBe('Nurse');
    expect(afterRefresh.current.impersonation?.impersonatorRoleName).toBe('Administrator');
  });
});
