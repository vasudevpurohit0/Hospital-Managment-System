export interface BrandingConfigRecord {
  hospitalName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string;
  updatedAt: string;
}

import { apiFetch } from './client';

export async function fetchBranding(): Promise<BrandingConfigRecord> {
  const res = await apiFetch('/api/branding');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch branding configuration');
  }
  return res.json();
}

export async function updateBranding(
  payload: Partial<BrandingConfigRecord>,
  token?: string,
): Promise<unknown> {
  const res = await apiFetch(
    '/api/branding',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || 'Failed to update branding configuration');
  }
  return res.json();
}
