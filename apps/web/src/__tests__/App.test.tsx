import { render, screen, waitFor } from '@testing-library/react';
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
      return {
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '1.0.0',
          uptime: 1234,
          timestamp: new Date().toISOString(),
        }),
      };
    });
  });

  it('renders without crashing and displays the title', async () => {
    render(<App />);

    // Check for title
    expect(screen.getByText('ESIC Hospital Management System')).toBeInTheDocument();
    expect(
      screen.getByText('Doctor Consultation & Digital Prescription Console'),
    ).toBeInTheDocument();
  });

  it('displays error state on health fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.includes('/api/health')) {
        return {
          ok: false,
          json: async () => ({ message: 'Health check failed' }),
        };
      }
      return {
        ok: true,
        json: async () => ({ accessToken: 'mock_token', user: { role: 'SuperAdmin' } }),
      };
    });

    render(<App />);

    // Switch to System Status tab
    const statusTabBtn = screen.getByText(/System Status/i);
    statusTabBtn.click();

    await waitFor(() => {
      expect(screen.getByText(/API Unreachable/i)).toBeInTheDocument();
    });
  });
});
