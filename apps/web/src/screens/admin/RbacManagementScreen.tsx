import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchRoles,
  fetchRolePermissions,
  fetchKnownResourceActions,
  grantPermission,
  revokePermission,
  RoleSummary,
  PermissionGrant,
  ResourceAction,
} from '../../api/rbacAdmin.api';
import { Badge } from '../../components/ui/Badge';
import { KeyRound, Shield, Trash2, Plus, RefreshCw } from 'lucide-react';

interface RbacManagementScreenProps {
  authToken: string;
}

export const RbacManagementScreen: React.FC<RbacManagementScreenProps> = ({ authToken }) => {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);
  const [knownActions, setKnownActions] = useState<ResourceAction[]>([]);
  const [newResource, setNewResource] = useState('');
  const [newAction, setNewAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ka] = await Promise.all([fetchRoles(authToken), fetchKnownResourceActions(authToken)]);
      setRoles(r);
      setKnownActions(ka);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const loadPermissions = useCallback(
    async (roleId: string) => {
      setSelectedRoleId(roleId);
      setError(null);
      try {
        const p = await fetchRolePermissions(roleId, authToken);
        setPermissions(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load permissions');
      }
    },
    [authToken],
  );

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const distinctResources = Array.from(new Set(knownActions.map((k) => k.resource))).sort();
  const actionsForResource = knownActions.filter((k) => k.resource === newResource).map((k) => k.action);

  const handleGrant = async () => {
    if (!selectedRoleId || !newResource.trim() || !newAction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await grantPermission({ roleId: selectedRoleId, resource: newResource.trim(), action: newAction.trim() }, authToken);
      setMessage(`Granted ${newResource}:${newAction}`);
      setNewResource('');
      setNewAction('');
      await loadPermissions(selectedRoleId);
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant permission');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (permissionId: string) => {
    if (!selectedRoleId) return;
    setBusy(true);
    setError(null);
    try {
      await revokePermission(permissionId, authToken);
      setMessage('Permission revoked.');
      await loadPermissions(selectedRoleId);
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke permission');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Roles & Permissions</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              The exact tables RbacGuard checks on every request (Feature 18) — a change here takes effect immediately.
            </p>
          </div>
        </div>
        <button onClick={loadRoles} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger text-sm font-semibold">{error}</div>}
      {message && <div className="alert alert-success text-sm font-semibold">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Role list */}
        <div className="lg:col-span-4 card p-4 space-y-1.5 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <p className="text-xs text-[var(--color-text-tertiary)] text-center py-8">Loading roles…</p>
          ) : (
            roles.map((r) => (
              <button
                key={r.id}
                onClick={() => loadPermissions(r.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between ${
                  selectedRoleId === r.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.name === 'SuperAdmin' && <Shield className="w-3.5 h-3.5 text-warning-500" />}
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">{r.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
                  <span>{r.permissionCount} grants</span>
                  <Badge variant="neutral" className="text-[9px] px-1.5 py-0.5">
                    {r.userCount} user(s)
                  </Badge>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Permissions for selected role */}
        <div className="lg:col-span-8 card p-5 space-y-4 min-h-[300px]">
          {!selectedRole ? (
            <p className="text-xs text-[var(--color-text-tertiary)] text-center py-16">
              Select a role to view and manage its permissions.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{selectedRole.name}</h3>
                <Badge variant="neutral">{permissions.length} permission(s)</Badge>
              </div>

              {selectedRole.name === 'SuperAdmin' ? (
                <div className="p-4 rounded-xl bg-warning-50 dark:bg-warning-950/20 border border-warning-200 dark:border-warning-900 text-xs text-warning-700 dark:text-warning-400">
                  SuperAdmin holds the universal wildcard (*:*) and bypasses this system's permission checks
                  entirely — its grants are not managed here.
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] space-y-2">
                    <p className="text-[11px] font-bold text-[var(--color-text-secondary)]">Grant a New Permission</p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        list="known-resources"
                        placeholder="Resource (e.g. LabOrder)"
                        value={newResource}
                        onChange={(e) => setNewResource(e.target.value)}
                        className="input text-xs py-1.5 flex-1 min-w-[160px]"
                      />
                      <datalist id="known-resources">
                        {distinctResources.map((r) => (
                          <option key={r} value={r} />
                        ))}
                      </datalist>
                      <input
                        list="known-actions"
                        placeholder="Action (e.g. read)"
                        value={newAction}
                        onChange={(e) => setNewAction(e.target.value)}
                        className="input text-xs py-1.5 flex-1 min-w-[120px]"
                      />
                      <datalist id="known-actions">
                        {actionsForResource.map((a) => (
                          <option key={a} value={a} />
                        ))}
                      </datalist>
                      <button
                        onClick={handleGrant}
                        disabled={busy || !newResource.trim() || !newAction.trim()}
                        className="btn btn-primary btn-sm gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Grant
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">
                      Suggestions are every resource/action already checked somewhere in the system —
                      picking one guarantees the grant actually unlocks something.
                    </p>
                  </div>

                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                    {permissions.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-tertiary)] text-center py-6">
                        No permissions granted to this role.
                      </p>
                    ) : (
                      permissions.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs"
                        >
                          <span className="font-mono font-semibold text-[var(--color-text-primary)]">
                            {p.resource}:{p.action}
                          </span>
                          <button
                            onClick={() => handleRevoke(p.id)}
                            disabled={busy}
                            className="text-danger-500 hover:text-danger-600 p-1"
                            title="Revoke"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
