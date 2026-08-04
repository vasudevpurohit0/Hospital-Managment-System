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

import { apiFetch } from './client';

export async function fetchBenefitRules(token?: string): Promise<BenefitRuleRecord[]> {
  const res = await apiFetch('/api/benefit-rules', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch benefit rules');
  }
  return res.json();
}

export async function evaluateBenefitRule(
  employmentType: string,
  medicineCategory: string | undefined,
  token?: string,
): Promise<{
  employmentType: string;
  medicineCategory: string | null;
  outcome: 'FREE' | 'COVERED' | 'PAID';
}> {
  const url = `/api/benefit-rules/evaluate?employmentType=${encodeURIComponent(
    employmentType,
  )}${medicineCategory ? `&medicineCategory=${encodeURIComponent(medicineCategory)}` : ''}`;

  const res = await apiFetch(url, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to evaluate benefit rule');
  }

  return res.json();
}
