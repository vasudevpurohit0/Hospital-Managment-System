import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { StaffManagementPage } from '../pages/StaffManagementPage';
import type { StaffProfile } from '../api/staff.api';

const AUTH_STORAGE_KEY = 'esic-hms-auth';

function seedAdminSession() {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      mode: 'hospital',
      token: 'admin-token',
      user: { id: 'admin-1', name: 'Self Admin', email: 'admin@esic.gov.in', role: 'Administrator' },
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      activeHospital: null,
    }),
  );
}

function staffFixture(overrides: Partial<StaffProfile> & { id: string }): StaffProfile {
  return {
    name: 'Staff Member',
    email: `${overrides.id}@esic.gov.in`,
    role: 'Nurse',
    staffId: `ESIC-${overrides.id}`,
    department: 'General Ward',
    designation: null,
    contactPhone: null,
    active: true,
    mustChangePassword: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    dateJoined: new Date().toISOString(),
    weeklySchedule: [],
    departments: [],
    locked: false,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

const eligibleNurse = () =>
  staffFixture({ id: 'nurse-1', name: 'Target Nurse', email: 'nurse@esic.gov.in', role: 'Nurse' });

/** Covers every UX-gate branch in StaffManagementPage.canImpersonate(). */
const mixedRoster = () => [
  eligibleNurse(),
  // Self -- same id as the seeded administrator session.
  staffFixture({ id: 'admin-1', name: 'Self Admin', email: 'admin@esic.gov.in', role: 'Administrator' }),
  // Locked account.
  staffFixture({ id: 'locked-1', name: 'Locked Nurse', email: 'locked@esic.gov.in', locked: true }),
  // Pending first-login setup.
  staffFixture({ id: 'pending-1', name: 'Pending Nurse', email: 'pending@esic.gov.in', mustChangePassword: true }),
  // Peer Hospital Administrator -- an Administrator requester may not impersonate one
  // (only a SuperAdmin platform actor may; enforced again server-side).
  staffFixture({ id: 'peer-admin-1', name: 'Peer Admin', email: 'peer@esic.gov.in', role: 'Administrator' }),
];

function AuthProbe() {
  const { user, token, impersonation } = useAuth();
  return (
    <div data-testid="auth-probe">
      <span data-testid="probe-role">{user?.role ?? 'none'}</span>
      <span data-testid="probe-token">{token ?? 'none'}</span>
      <span data-testid="probe-impersonator">{impersonation?.impersonatorIdentifier ?? 'none'}</span>
    </div>
  );
}

interface MockPlan {
  roster?: StaffProfile[];
  impersonate?: { ok: true } | { ok: false; message: string };
}

function mockBackend(plan: MockPlan = {}) {
  const roster = plan.roster ?? [eligibleNurse()];
  const impersonate = plan.impersonate ?? { ok: true as const };
  const fetchMock = vi.fn(async (url: any, opts?: any) => {
    const u = String(url instanceof Request ? url.url : url);
    const method = (opts?.method || 'GET').toUpperCase();
    if (u.includes('/impersonate') && method === 'POST') {
      if (impersonate.ok) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'target-token',
            expiresIn: '15m',
            target: { id: 'nurse-1', identifier: 'nurse@esic.gov.in', role: 'Nurse', name: 'Target Nurse' },
          }),
        };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: (impersonate as { message: string }).message }),
      };
    }
    if (u.includes('/api/staff')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: roster,
          meta: { total: roster.length, page: 1, limit: 25, totalPages: 1 },
        }),
      };
    }
    if (u.includes('/api/departments')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderPage() {
  render(
    <AuthProvider>
      <AuthProbe />
      <StaffManagementPage />
    </AuthProvider>,
  );
}

describe('StaffManagementPage impersonation flow (button -> modal -> session swap)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows Impersonate only for eligible staff and completes the confirm flow', async () => {
    seedAdminSession();
    const fetchMock = mockBackend({ roster: mixedRoster() });
    renderPage();

    // Roster loads (loadStaff is debounced ~250ms, so this also waits past that).
    await screen.findByText('Target Nurse');
    await screen.findByText('Locked Nurse');
    await screen.findByText('Pending Nurse');
    await screen.findByText('Peer Admin');

    // Exactly one eligible target out of the five cards: self, locked,
    // pending-setup and peer-Administrator cards must NOT offer the button.
    // (Every one of these UX gates is re-enforced server-side; hiding the
    // button only avoids offering an action that would 400/403 anyway.)
    const buttons = screen.getAllByRole('button', { name: 'Impersonate' });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);

    // Confirm dialog names the exact target being entered.
    await screen.findByText('Impersonate User?');
    expect(screen.getAllByText(/Target Nurse/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/nurse@esic.gov.in/).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // The impersonate endpoint is hit for the eligible target...
    await waitFor(() => {
      const hit = fetchMock.mock.calls.some(([url, opts]) =>
        String(url).includes('/api/staff/nurse-1/impersonate') && (opts?.method || '').toUpperCase() === 'POST',
      );
      expect(hit).toBe(true);
    });

    // ...the dialog closes, and the active session swaps to the target while
    // the original administrator session is stashed for exit-restore.
    await waitFor(() => {
      expect(screen.queryByText('Impersonate User?')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-role')).toHaveTextContent('Nurse');
      expect(screen.getByTestId('probe-impersonator')).toHaveTextContent('admin@esic.gov.in');
    });
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
    expect(stored.token).toBe('target-token');
    expect(stored.impersonation.original.token).toBe('admin-token');
    expect(stored.impersonation.original.user.role).toBe('Administrator');
  });

  it('Cancel closes the confirm dialog without calling the impersonate endpoint', async () => {
    seedAdminSession();
    const fetchMock = mockBackend();
    renderPage();

    await screen.findByText('Target Nurse');
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate' }));
    await screen.findByText('Impersonate User?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Impersonate User?')).toBeNull();
    });
    const impersonateCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/impersonate'));
    expect(impersonateCalls).toHaveLength(0);
    // Original session untouched.
    expect(screen.getByTestId('probe-role')).toHaveTextContent('Administrator');
    expect(screen.getByTestId('probe-token')).toHaveTextContent('admin-token');
  });

  it('surfaces a server-side rejection in the error banner', async () => {
    seedAdminSession();
    mockBackend({ impersonate: { ok: false, message: 'Cannot impersonate a deactivated account.' } });
    renderPage();

    await screen.findByText('Target Nurse');
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate' }));
    await screen.findByText('Impersonate User?');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // The backend is authoritative: the UI surfaces whichever rule failed...
    await screen.findByText('Cannot impersonate a deactivated account.');
    // ...and the admin keeps their own session (no swap on failure).
    expect(screen.getByTestId('probe-role')).toHaveTextContent('Administrator');
    expect(screen.getByTestId('probe-token')).toHaveTextContent('admin-token');
  });
});
