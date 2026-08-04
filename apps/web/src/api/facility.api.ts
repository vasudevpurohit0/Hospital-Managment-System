export interface FacilityEligibilityRuleRecord {
  id: string;
  postId: string | null;
  gradeId: string | null;
  category: 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL';
  wardEligibility: string;
  room: string;
  facilityLevel: string;
  active: boolean;
  version: number;
  post?: {
    id: string;
    title: string;
  } | null;
  grade?: {
    id: string;
    payLevel: string;
  } | null;
}

import { apiFetch } from './client';

export async function fetchFacilityRules(token?: string): Promise<FacilityEligibilityRuleRecord[]> {
  const res = await apiFetch('/api/facility-rules', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch facility rules');
  }
  return res.json();
}

export async function updateFacilityRule(
  id: string,
  body: {
    category: 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL';
    wardEligibility: string;
    room: string;
    facilityLevel: string;
  },
  token?: string,
): Promise<FacilityEligibilityRuleRecord> {
  const res = await apiFetch(
    `/api/facility-rules/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update facility rule');
  }
  return res.json();
}

export async function resolveFacilityRule(
  employeeId: string,
  token?: string,
): Promise<{
  category: 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL';
  wardEligibility: string;
  room: string;
  facilityLevel: string;
  ruleId: string;
  version: number;
}> {
  const res = await apiFetch(
    `/api/facility-rules/resolve?employeeId=${encodeURIComponent(employeeId)}`,
    {},
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to resolve facility eligibility rule');
  }
  return res.json();
}
