import { apiFetch } from './client';

export type ServiceType =
  | 'CONSULTATION'
  | 'TEST'
  | 'THERAPY'
  | 'PROCEDURE'
  | 'PACKAGE'
  | 'BED_DAY'
  | 'CARE_PER_DAY';

export type ServiceApplicability = 'OPD' | 'IPD' | 'BOTH';
export type ServiceUnit = 'SITTING' | 'SESSION' | 'DAY' | 'COURSE' | 'TEST' | 'VISIT';

export interface ServiceCategoryRecord {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
  serviceCount: number;
}

export interface ServiceListItem {
  id: string;
  code: string;
  name: string;
  category: string;
  categoryId: string;
  serviceType: ServiceType;
  applicability: ServiceApplicability;
  unit: ServiceUnit;
  active: boolean;
  sourceReference: string | null;
  componentCount: number;
  /** Rupees as a decimal string, or null when the service has no rate. */
  currentPrice: string | null;
  currentPriceEffectiveFrom: string | null;
  isPriced: boolean;
}

export interface ServiceListResponse {
  total: number;
  page: number;
  limit: number;
  items: ServiceListItem[];
}

export interface PriceVersion {
  id: string;
  amount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  reason: string;
  changedBy: string | null;
  changedAt: string;
}

export interface PriceHistory {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  versions: PriceVersion[];
}

export interface UnpricedService {
  id: string;
  code: string;
  name: string;
  category: string;
  serviceType: ServiceType;
  sourceReference: string | null;
}

export interface ServiceListQuery {
  search?: string;
  categoryId?: string;
  serviceType?: ServiceType;
  applicability?: ServiceApplicability;
  active?: boolean;
  unpricedOnly?: boolean;
  page?: number;
  limit?: number;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

export async function fetchServiceCategories(token?: string): Promise<ServiceCategoryRecord[]> {
  const res = await apiFetch('/api/catalog/categories', {}, token);
  return unwrap(res, 'Failed to load service categories');
}

export async function fetchServices(
  query: ServiceListQuery = {},
  token?: string,
): Promise<ServiceListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.serviceType) params.set('serviceType', query.serviceType);
  if (query.applicability) params.set('applicability', query.applicability);
  if (query.active !== undefined) params.set('active', String(query.active));
  if (query.unpricedOnly) params.set('unpricedOnly', 'true');
  params.set('page', String(query.page ?? 1));
  params.set('limit', String(query.limit ?? 50));

  const res = await apiFetch(`/api/catalog/services?${params.toString()}`, {}, token);
  return unwrap(res, 'Failed to load services');
}

export async function fetchPriceHistory(
  serviceId: string,
  token?: string,
): Promise<PriceHistory> {
  const res = await apiFetch(`/api/catalog/services/${serviceId}/price-history`, {}, token);
  return unwrap(res, 'Failed to load price history');
}

export async function fetchUnpricedServices(token?: string): Promise<UnpricedService[]> {
  const res = await apiFetch('/api/catalog/services/unpriced', {}, token);
  return unwrap(res, 'Failed to load unpriced services');
}

/**
 * Supersedes the current rate. The server closes the open version and opens a
 * new one; no existing bill is affected.
 */
export async function setServicePrice(
  serviceId: string,
  body: { amount: number; effectiveFrom?: string; reason: string },
  token?: string,
): Promise<{ previous: { amount: string; effectiveFrom: string } | null }> {
  const res = await apiFetch(
    `/api/catalog/services/${serviceId}/prices`,
    { method: 'POST', body: JSON.stringify(body) },
    token,
  );
  return unwrap(res, 'Failed to update price');
}
