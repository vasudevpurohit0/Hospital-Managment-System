import { apiFetch } from './http';

export interface BenefitRuleRecord {
  id: string;
  employmentTypeId: string;
  medicineCategory: string | null;
  outcome: 'FREE' | 'COVERED' | 'PAID';
  active: boolean;
  version: number;
  employmentType?: {
    code: string;
    name: string;
  };
}

export async function fetchBenefitRules(token: string): Promise<BenefitRuleRecord[]> {
  return apiFetch<BenefitRuleRecord[]>(
    '/api/benefit-rules',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch benefit rules',
  );
}

export async function evaluateBenefitRule(
  employmentType: string,
  medicineCategory: string | undefined,
  token: string,
): Promise<{
  employmentType: string;
  medicineCategory: string | null;
  outcome: 'FREE' | 'COVERED' | 'PAID';
}> {
  const url = `/api/benefit-rules/evaluate?employmentType=${encodeURIComponent(
    employmentType,
  )}${medicineCategory ? `&medicineCategory=${encodeURIComponent(medicineCategory)}` : ''}`;

  return apiFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to evaluate benefit rule',
  );
}
