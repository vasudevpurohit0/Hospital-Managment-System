import { apiFetch } from './http';

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

export async function fetchFacilityRules(token: string): Promise<FacilityEligibilityRuleRecord[]> {
  return apiFetch<FacilityEligibilityRuleRecord[]>(
    '/api/facility-rules',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch facility rules',
  );
}

export async function updateFacilityRule(
  id: string,
  body: {
    category: 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL';
    wardEligibility: string;
    room: string;
    facilityLevel: string;
  },
  token: string,
): Promise<FacilityEligibilityRuleRecord> {
  return apiFetch<FacilityEligibilityRuleRecord>(
    `/api/facility-rules/${id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    'Failed to update facility rule',
  );
}

export async function resolveFacilityRule(
  employeeId: string,
  token: string,
): Promise<{
  category: 'A' | 'B' | 'C' | 'D' | 'CONTRACTUAL';
  wardEligibility: string;
  room: string;
  facilityLevel: string;
  ruleId: string;
  version: number;
}> {
  return apiFetch(
    `/api/facility-rules/resolve?employeeId=${encodeURIComponent(employeeId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to resolve facility eligibility rule',
  );
}
