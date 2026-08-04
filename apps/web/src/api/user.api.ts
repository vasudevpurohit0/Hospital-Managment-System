export interface UserSummary {
  id: string;
  identifier: string;
  role: string;
}

import { apiFetch } from './client';

export async function fetchUsersByRole(role: string, token?: string): Promise<UserSummary[]> {
  const res = await apiFetch(`/api/users?role=${encodeURIComponent(role)}`, {}, token);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch users');
  }

  return res.json();
}
