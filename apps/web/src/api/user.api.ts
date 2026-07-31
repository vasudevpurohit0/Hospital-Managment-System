import { apiFetch } from './http';

export interface UserSummary {
  id: string;
  identifier: string;
  role: string;
}

export async function fetchUsersByRole(role: string, token: string): Promise<UserSummary[]> {
  return apiFetch<UserSummary[]>(
    `/api/users?role=${encodeURIComponent(role)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch users',
  );
}
