export interface HospitalSettingsRecord {
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: string[];
  currency: string;
  taxPercent: string;
  billingPrefix: string;
  notifyOnAdmission: boolean;
  notifyOnDischarge: boolean;
  notifyOnLowStock: boolean;
  updatedAt: string;
}

import { apiFetch } from './client';

export async function fetchHospitalSettings(token?: string): Promise<HospitalSettingsRecord> {
  const res = await apiFetch('/api/settings/hospital', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch hospital settings');
  }
  return res.json();
}

export interface UpdateHospitalSettingsPayload {
  workingHoursStart?: string;
  workingHoursEnd?: string;
  workingDays?: string[];
  currency?: string;
  /** A plain number here (unlike HospitalSettingsRecord.taxPercent, which is a Decimal serialized as a string by the API). */
  taxPercent?: number;
  billingPrefix?: string;
  notifyOnAdmission?: boolean;
  notifyOnDischarge?: boolean;
  notifyOnLowStock?: boolean;
}

export async function updateHospitalSettings(
  payload: UpdateHospitalSettingsPayload,
  token?: string,
): Promise<unknown> {
  const res = await apiFetch('/api/settings/hospital', { method: 'PUT', body: JSON.stringify(payload) }, token);
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || 'Failed to update hospital settings');
  }
  return res.json();
}
