import { apiFetch } from './client';

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to change password');
  }
}

/** No auth token exists yet -- the activation token itself is the credential. */
export async function activateAccount(
  token: string,
  newPassword: string,
): Promise<{ status: string; message: string }> {
  const res = await apiFetch('/api/auth/activate-account', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to activate account');
  }
  return res.json();
}

/**
 * Starts a password reset. Reachable with no session -- the identifier is all
 * the backend needs. The API deliberately answers with the same generic
 * message whether or not the account exists (anti-enumeration), so the caller
 * must render whatever `message` comes back rather than inferring success.
 */
export async function forgotPassword(
  identifier: string,
): Promise<{ status: string; message: string }> {
  const res = await apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Could not start the password reset. Please try again.');
  }
  return res.json();
}
