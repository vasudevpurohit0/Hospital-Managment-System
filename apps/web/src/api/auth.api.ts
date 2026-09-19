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
export async function activateAccount(token: string, newPassword: string): Promise<{ status: string; message: string }> {
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
