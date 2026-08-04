import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';

/** Fills in the login form fields, since the form no longer ships with pre-filled dev credentials. */
function fillLoginForm(identifier = 'doctor@esic.gov.in', password = 'DoctorPass123!') {
  fireEvent.change(screen.getByLabelText(/Government Email \/ User ID/i), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(/Password/i), {
    target: { value: password },
  });
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset fetch mock before each test
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/login')) {
        return {
          ok: true,
          json: async () => ({ accessToken: 'mock_token', user: { role: 'SuperAdmin' } }),
        };
      }
      if (url.includes('/api/dashboard/summary')) {
        return {
          ok: true,
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    });
  });

  it('renders the login page when the user is not authenticated', async () => {
    render(<App />);

    expect(screen.getByText('Authorized Personnel Login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Secure Login/i })).toBeInTheDocument();
  });

  it('logs in successfully and renders the authenticated dashboard', async () => {
    render(<App />);

    fillLoginForm();
    fireEvent.click(screen.getByRole('button', { name: /Secure Login/i }));

    await waitFor(() => {
      expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    });
  });

  it('displays error state on health fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/login')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: 'Invalid credentials' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fillLoginForm();
    fireEvent.click(screen.getByRole('button', { name: /Secure Login/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Authorized Personnel Login')).toBeInTheDocument();
  });
});
