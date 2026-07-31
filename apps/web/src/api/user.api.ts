export interface UserSummary {
  id: string;
  identifier: string;
  role: string;
}

export async function fetchUsersByRole(role: string, token: string): Promise<UserSummary[]> {
  const res = await fetch(`/api/users?role=${encodeURIComponent(role)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch users');
  }

  return res.json();
}
