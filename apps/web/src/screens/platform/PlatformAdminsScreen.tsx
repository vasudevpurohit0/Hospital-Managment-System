import React, { useEffect, useState } from 'react';
import {
  listPlatformAdmins,
  createPlatformAdmin,
  setPlatformAdminActive,
  PlatformAdminRecord,
  listHospitalAdmins,
  createHospitalAdmin,
  setHospitalAdminActive,
  HospitalAdminRecord,
  listHospitals,
  HospitalRecord,
} from '../../api/platform.api';
import { useAuth } from '../../hooks/useAuth';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { ShieldCheck, Building2, Plus, RefreshCw, Ban, RotateCcw, X } from 'lucide-react';

export const PlatformAdminsScreen: React.FC = () => {
  const { user } = useAuth();

  /* ── Platform (Super Admin) accounts ── */
  const [admins, setAdmins] = useState<PlatformAdminRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pendingToggle, setPendingToggle] = useState<PlatformAdminRecord | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  /* ── Hospital administrators (cross-hospital roster) ── */
  const [hospitalAdmins, setHospitalAdmins] = useState<HospitalAdminRecord[]>([]);
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [hospitalAdminsLoading, setHospitalAdminsLoading] = useState(false);
  const [hospitalAdminsError, setHospitalAdminsError] = useState<string | null>(null);
  const [showCreateHospitalAdmin, setShowCreateHospitalAdmin] = useState(false);

  const [newAdminHospitalId, setNewAdminHospitalId] = useState('');
  const [newAdminIdentifier, setNewAdminIdentifier] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [creatingHospitalAdmin, setCreatingHospitalAdmin] = useState(false);
  const [createHospitalAdminError, setCreateHospitalAdminError] = useState<string | null>(null);

  const [pendingHospitalAdminToggle, setPendingHospitalAdminToggle] = useState<HospitalAdminRecord | null>(null);
  const [togglingHospitalAdmin, setTogglingHospitalAdmin] = useState(false);
  const [hospitalAdminToggleError, setHospitalAdminToggleError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAdmins(await listPlatformAdmins());
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load platform admins');
    } finally {
      setLoading(false);
    }
  };

  const loadHospitalAdmins = async () => {
    setHospitalAdminsLoading(true);
    setHospitalAdminsError(null);
    try {
      const [rosterResult, hospitalsResult] = await Promise.all([listHospitalAdmins(), listHospitals()]);
      setHospitalAdmins(rosterResult);
      setHospitals(hospitalsResult.filter((h) => h.status !== 'PROVISIONING'));
    } catch (err: unknown) {
      setHospitalAdminsError((err as Error).message || 'Failed to load hospital administrators');
    } finally {
      setHospitalAdminsLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadHospitalAdmins();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createPlatformAdmin({ email, name, password });
      setShowCreate(false);
      setName('');
      setEmail('');
      setPassword('');
      load();
    } catch (err: unknown) {
      setCreateError((err as Error).message || 'Failed to create platform admin');
    } finally {
      setCreating(false);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    try {
      await setPlatformAdminActive(pendingToggle.id, !pendingToggle.active);
      setPendingToggle(null);
      load();
    } catch (err: unknown) {
      setToggleError((err as Error).message || 'Failed to update platform admin');
    } finally {
      setToggling(false);
    }
  };

  const handleCreateHospitalAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingHospitalAdmin(true);
    setCreateHospitalAdminError(null);
    try {
      await createHospitalAdmin(newAdminHospitalId, newAdminIdentifier, newAdminPassword);
      setShowCreateHospitalAdmin(false);
      setNewAdminHospitalId('');
      setNewAdminIdentifier('');
      setNewAdminPassword('');
      loadHospitalAdmins();
    } catch (err: unknown) {
      setCreateHospitalAdminError((err as Error).message || 'Failed to create hospital admin');
    } finally {
      setCreatingHospitalAdmin(false);
    }
  };

  const confirmHospitalAdminToggle = async () => {
    if (!pendingHospitalAdminToggle) return;
    setTogglingHospitalAdmin(true);
    setHospitalAdminToggleError(null);
    try {
      await setHospitalAdminActive(
        pendingHospitalAdminToggle.hospitalId,
        pendingHospitalAdminToggle.id,
        !pendingHospitalAdminToggle.active,
      );
      setPendingHospitalAdminToggle(null);
      loadHospitalAdmins();
    } catch (err: unknown) {
      setHospitalAdminToggleError((err as Error).message || 'Failed to update hospital admin');
    } finally {
      setTogglingHospitalAdmin(false);
    }
  };

  const columns: Column<PlatformAdminRecord>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (a) => (
        <span>
          {a.name}
          {a.email === user?.email && (
            <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">(you)</span>
          )}
        </span>
      ),
    },
    { key: 'email', header: 'Email', sortable: true },
    {
      key: 'active',
      header: 'Status',
      sortable: true,
      render: (a) => <Badge variant={a.active ? 'success' : 'neutral'}>{a.active ? 'ACTIVE' : 'INACTIVE'}</Badge>,
    },
  ];

  const hospitalAdminColumns: Column<HospitalAdminRecord>[] = [
    { key: 'identifier', header: 'Login Identifier', sortable: true },
    { key: 'hospitalName', header: 'Hospital', sortable: true },
    {
      key: 'active',
      header: 'Status',
      sortable: true,
      render: (a) => <Badge variant={a.active ? 'success' : 'neutral'}>{a.active ? 'ACTIVE' : 'INACTIVE'}</Badge>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-secondary-50 border border-secondary-100 text-secondary-600 dark:bg-secondary-950/30 dark:border-secondary-900/50 dark:text-secondary-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Platform Admins</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              Super Admin accounts that can see and manage every hospital on this platform.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-secondary gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            New Admin
          </button>
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}
      {toggleError && <div className="alert-danger">{toggleError}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">New Platform Admin</h2>
            <button type="button" onClick={() => setShowCreate(false)} className="btn btn-ghost btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>
          {createError && <div className="alert-danger">{createError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={creating}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={creating}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={creating}
                className="input"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="btn btn-primary">
              {creating ? 'Creating...' : 'Create Admin'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} disabled={creating} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && admins.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] py-4">Loading platform admins...</p>
      ) : (
      <DataTable
        title="All Platform Admins"
        data={admins}
        columns={columns}
        keyExtractor={(a) => a.id}
        searchableKey="email"
        searchPlaceholder="Search admins..."
        actions={(a) => {
          const isSelf = a.email === user?.email;
          return (
            <button
              onClick={() => setPendingToggle(a)}
              disabled={isSelf}
              title={isSelf ? 'You cannot deactivate your own account' : undefined}
              className="btn btn-secondary btn-sm gap-1"
            >
              {a.active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {a.active ? 'Deactivate' : 'Reactivate'}
            </button>
          );
        }}
      />
      )}

      {/* ── Hospital Administrators (cross-hospital roster) ── */}
      <div className="card p-6 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary-50 border border-primary-100 text-primary-600 dark:bg-primary-950/30 dark:border-primary-900/50 dark:text-primary-400">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Hospital Administrators</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              Every hospital-local Administrator across every hospital on this platform, in one place.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={loadHospitalAdmins} className="btn btn-secondary gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button onClick={() => setShowCreateHospitalAdmin(true)} className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            New Hospital Admin
          </button>
        </div>
      </div>

      {hospitalAdminsError && <div className="alert-danger">{hospitalAdminsError}</div>}
      {hospitalAdminToggleError && <div className="alert-danger">{hospitalAdminToggleError}</div>}

      {showCreateHospitalAdmin && (
        <form onSubmit={handleCreateHospitalAdmin} className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">New Hospital Administrator</h2>
            <button type="button" onClick={() => setShowCreateHospitalAdmin(false)} className="btn btn-ghost btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>
          {createHospitalAdminError && <div className="alert-danger">{createHospitalAdminError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Hospital</label>
              <select
                value={newAdminHospitalId}
                onChange={(e) => setNewAdminHospitalId(e.target.value)}
                required
                disabled={creatingHospitalAdmin}
                className="input"
              >
                <option value="" disabled>
                  Select a hospital...
                </option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Login identifier</label>
              <input
                type="text"
                value={newAdminIdentifier}
                onChange={(e) => setNewAdminIdentifier(e.target.value)}
                required
                disabled={creatingHospitalAdmin}
                placeholder="administrator@..."
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Password</label>
              <input
                type="password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                required
                minLength={8}
                disabled={creatingHospitalAdmin}
                className="input"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creatingHospitalAdmin} className="btn btn-primary">
              {creatingHospitalAdmin ? 'Creating...' : 'Create Admin'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateHospitalAdmin(false)}
              disabled={creatingHospitalAdmin}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {hospitalAdminsLoading && hospitalAdmins.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] py-4">Loading hospital administrators...</p>
      ) : (
      <DataTable
        title="All Hospital Administrators"
        data={hospitalAdmins}
        columns={hospitalAdminColumns}
        keyExtractor={(a) => a.id}
        searchableKey="identifier"
        searchPlaceholder="Search by identifier..."
        actions={(a) => (
          <button
            onClick={() => setPendingHospitalAdminToggle(a)}
            className="btn btn-secondary btn-sm gap-1"
          >
            {a.active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
            {a.active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      />
      )}

      {pendingToggle && (
        <ConfirmModal
          title={pendingToggle.active ? 'Deactivate platform admin?' : 'Reactivate platform admin?'}
          message={
            pendingToggle.active
              ? `${pendingToggle.name} will no longer be able to sign in to the Platform Console.`
              : `${pendingToggle.name} will be able to sign in to the Platform Console again.`
          }
          confirmLabel={pendingToggle.active ? 'Deactivate' : 'Reactivate'}
          danger={pendingToggle.active}
          busy={toggling}
          onConfirm={confirmToggle}
          onCancel={() => setPendingToggle(null)}
        />
      )}

      {pendingHospitalAdminToggle && (
        <ConfirmModal
          title={
            pendingHospitalAdminToggle.active
              ? `Deactivate ${pendingHospitalAdminToggle.identifier}?`
              : `Reactivate ${pendingHospitalAdminToggle.identifier}?`
          }
          message={
            pendingHospitalAdminToggle.active
              ? `They will no longer be able to sign in to ${pendingHospitalAdminToggle.hospitalName}. This is blocked if they are the last remaining active Administrator there.`
              : `They will be able to sign in to ${pendingHospitalAdminToggle.hospitalName} again.`
          }
          confirmLabel={pendingHospitalAdminToggle.active ? 'Deactivate' : 'Reactivate'}
          danger={pendingHospitalAdminToggle.active}
          busy={togglingHospitalAdmin}
          onConfirm={confirmHospitalAdminToggle}
          onCancel={() => setPendingHospitalAdminToggle(null)}
        />
      )}
    </div>
  );
};
