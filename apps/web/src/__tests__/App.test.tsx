import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';

describe('App', () => {
  beforeEach(() => {
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

    fireEvent.click(screen.getByRole('button', { name: /Secure Login/i }));

    await waitFor(() => {
      expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    });
  });

  it('displays error state on health fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/api/health')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: 'Invalid credentials' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Secure Login/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Authorized Personnel Login')).toBeInTheDocument();
  });
});
