import { apiFetch } from './client';

export interface RoleSummary {
  id: string;
  name: string;
  isSystemRole: boolean;
  permissionCount: number;
  userCount: number;
}

export interface PermissionGrant {
  id: string;
  roleId: string;
  resource: string;
  action: string;
  createdAt: string;
}

export interface ResourceAction {
  resource: string;
  action: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

/** Feature 18 — the real RBAC tables RbacGuard enforces on every request, made visible/editable. */
export async function fetchRoles(token?: string): Promise<RoleSummary[]> {
  const res = await apiFetch('/api/rbac/roles', {}, token);
  return unwrap(res, 'Failed to load roles');
}

export async function fetchRolePermissions(roleId: string, token?: string): Promise<PermissionGrant[]> {
  const res = await apiFetch(`/api/rbac/roles/${roleId}/permissions`, {}, token);
  return unwrap(res, 'Failed to load role permissions');
}

export async function fetchKnownResourceActions(token?: string): Promise<ResourceAction[]> {
  const res = await apiFetch('/api/rbac/known-resource-actions', {}, token);
  return unwrap(res, 'Failed to load known resource/action catalogue');
}

export async function grantPermission(
  payload: { roleId: string; resource: string; action: string },
  token?: string,
): Promise<PermissionGrant> {
  const res = await apiFetch('/api/rbac/permissions', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to grant permission');
}

export async function revokePermission(permissionId: string, token?: string): Promise<void> {
  const res = await apiFetch(`/api/rbac/permissions/${permissionId}`, { method: 'DELETE' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to revoke permission');
  }
}
