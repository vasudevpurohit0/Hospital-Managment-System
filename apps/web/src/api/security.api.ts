import { apiFetch } from './http';

export interface BrandingConfigRecord {
  hospitalName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string;
  updatedAt: string;
}

export async function fetchBranding(): Promise<BrandingConfigRecord> {
  return apiFetch<BrandingConfigRecord>(
    '/api/branding',
    undefined,
    'Failed to fetch branding configuration',
  );
}

export async function updateBranding(
  payload: Partial<BrandingConfigRecord>,
  token: string,
): Promise<unknown> {
  return apiFetch(
    '/api/branding',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to update branding configuration',
  );
}
