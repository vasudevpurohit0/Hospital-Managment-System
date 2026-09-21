import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider } from '../hooks/useAuth';
import { StaffManagementPage } from '../pages/StaffManagementPage';

const AUTH_STORAGE_KEY = 'esic-hms-auth';

const nurse = {
  id: 'nurse-1',
  name: 'Target Nurse',
  email: 'nurse@esic.gov.in',
  role: 'Nurse',
  staffId: 'NUR-0001',
  department: 'General Ward',
  designation: 'Staff Nurse',
  contactPhone: null,
  active: true,
  locked: false,
  mustChangePassword: false,
  passwordChangedAt: null,
  lastLoginAt: null,
  dateJoined: '2026-01-01',
  weeklySchedule: [],
  departments: [],
};

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

describe('StaffManagementPage -- Impersonate button', () => {
  beforeEach(() => {
    localStorage.clear();
    seedAdminSession();
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/staff/') && url.includes('/impersonate')) {
        return {
          ok: true,
          json: async () => ({
            accessToken: 'impersonation-token',
            expiresIn: '60m',
            target: { id: nurse.id, identifier: nurse.email, role: nurse.role, name: nurse.name },
          }),
        };
      }
      if (url.includes('/api/staff')) {
        return { ok: true, json: async () => ({ items: [nurse], meta: { total: 1, totalPages: 1 } }) };
      }
      if (url.includes('/api/departments')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  it('shows the Impersonate button for an eligible staff member and starts a session on confirm', async () => {
    render(
      <AuthProvider>
        <StaffManagementPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Target Nurse')).toBeInTheDocument());

    const impersonateButton = screen.getByRole('button', { name: /impersonate/i });
    expect(impersonateButton).toBeInTheDocument();
    fireEvent.click(impersonateButton);

    // Confirmation dialog shown first -- clicking the button alone must never start the session.
    await waitFor(() => expect(screen.getByText('Impersonate User?')).toBeInTheDocument());
    expect(screen.getAllByText(/Target Nurse/).length).toBeGreaterThan(0);
    expect(
      JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).token,
    ).toBe('admin-token'); // unchanged until confirmed

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
      expect(stored.token).toBe('impersonation-token');
      expect(stored.user.role).toBe('Nurse');
      expect(stored.impersonation.original.token).toBe('admin-token');
    });

    const impersonateCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/impersonate'),
    );
    expect(impersonateCall).toBeDefined();
    expect(impersonateCall![1].method).toBe('POST');
  });

  it('does not call the API if the confirmation dialog is cancelled', async () => {
    render(
      <AuthProvider>
        <StaffManagementPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Target Nurse')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /impersonate/i }));
    await waitFor(() => expect(screen.getByText('Impersonate User?')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByText('Impersonate User?')).not.toBeInTheDocument());
    const impersonateCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/impersonate'),
    );
    expect(impersonateCall).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).token).toBe('admin-token');
  });

  it('hides the Impersonate button for a deactivated staff member', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/api/staff')) {
        return { ok: true, json: async () => ({ items: [{ ...nurse, active: false }], meta: { total: 1, totalPages: 1 } }) };
      }
      if (url.includes('/api/departments')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({}) };
    });

    render(
      <AuthProvider>
        <StaffManagementPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Target Nurse')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /impersonate/i })).not.toBeInTheDocument();
  });
});
