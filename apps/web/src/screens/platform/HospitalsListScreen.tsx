import React, { useEffect, useState } from 'react';
import {
  listHospitals,
  setHospitalStatus,
  deleteHospital,
  updateHospital,
  resetHospitalUserPassword,
  HospitalRecord,
} from '../../api/platform.api';
import { useAuth } from '../../hooks/useAuth';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Building2, Plus, RefreshCw, LogIn, Pencil, KeyRound, PauseCircle, PlayCircle, Trash2, X } from 'lucide-react';
import { formatDateDefault } from '../../utils/date';

interface HospitalsListScreenProps {
  onCreateHospital: () => void;
}

type PendingAction =
  | { type: 'suspend' | 'activate'; hospital: HospitalRecord }
  | { type: 'delete'; hospital: HospitalRecord };

export const HospitalsListScreen: React.FC<HospitalsListScreenProps> = ({ onCreateHospital }) => {
  const { enterHospital } = useAuth();
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<HospitalRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [resetting, setResetting] = useState<HospitalRecord | null>(null);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setHospitals(await listHospitals());
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load hospitals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = (h: HospitalRecord) => {
    setEditing(h);
    setEditName(h.name);
    setEditError(null);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateHospital(editing.id, { name: editName });
      setEditing(null);
      load();
    } catch (err: unknown) {
      setEditError((err as Error).message || 'Failed to update hospital');
    } finally {
      setEditSaving(false);
    }
  };

  const openReset = (h: HospitalRecord) => {
    setResetting(h);
    setResetIdentifier('');
    setResetPassword('');
    setResetError(null);
    setResetSuccess(null);
  };

  const saveReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetting) return;
    setResetSaving(true);
    setResetError(null);
    setResetSuccess(null);
    try {
      await resetHospitalUserPassword(resetting.id, resetIdentifier, resetPassword);
      setResetSuccess(`Password reset for ${resetIdentifier}.`);
      setResetPassword('');
    } catch (err: unknown) {
      setResetError((err as Error).message || 'Failed to reset password');
    } finally {
      setResetSaving(false);
    }
  };

  const runPendingAction = async () => {
    if (!pending) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (pending.type === 'delete') {
        await deleteHospital(pending.hospital.id);
      } else {
        await setHospitalStatus(pending.hospital.id, pending.type === 'suspend' ? 'SUSPENDED' : 'ACTIVE');
      }
      setPending(null);
      load();
    } catch (err: unknown) {
      setActionError((err as Error).message || 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  const columns: Column<HospitalRecord>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'slug', header: 'Identifier suffix', render: (h) => <span className="font-mono text-xs">{h.slug}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (h) => (
        <Badge variant={h.status === 'ACTIVE' ? 'success' : h.status === 'SUSPENDED' ? 'danger' : 'warning'}>
          {h.status}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (h) => formatDateDefault(h.createdAt),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary-50 border border-primary-100 text-primary-600 dark:bg-primary-950/30 dark:border-primary-900/50 dark:text-primary-400">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Hospitals</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              Every hospital on this platform. Enter one to view and manage its data directly.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-secondary gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button onClick={onCreateHospital} className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            New Hospital
          </button>
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}
      {actionError && <div className="alert-danger">{actionError}</div>}

      {loading && hospitals.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] py-4">Loading hospitals...</p>
      ) : (
      <DataTable
        title="All Hospitals"
        data={hospitals}
        columns={columns}
        keyExtractor={(h) => h.id}
        searchableKey="name"
        searchPlaceholder="Search hospitals by name or identifier..."
        actions={(h) => (
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            <button
              onClick={() => enterHospital({ id: h.id, name: h.name })}
              disabled={h.status !== 'ACTIVE'}
              className="btn btn-ghost btn-sm gap-1"
              title="Enter hospital"
            >
              <LogIn className="w-3.5 h-3.5" />
              Enter
            </button>
            <button onClick={() => openEdit(h)} className="btn btn-secondary btn-sm gap-1">
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={() => openReset(h)}
              disabled={h.status === 'PROVISIONING'}
              className="btn btn-secondary btn-sm gap-1"
              title="Reset a user's password"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Reset
            </button>
            {h.status === 'ACTIVE' && (
              <button
                onClick={() => setPending({ type: 'suspend', hospital: h })}
                className="btn btn-sm gap-1 bg-warning-50 text-warning-700 border-warning-100 hover:bg-warning-100 dark:bg-warning-950/30 dark:text-warning-400 dark:border-warning-900/50"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                Suspend
              </button>
            )}
            {h.status === 'SUSPENDED' && (
              <>
                <button
                  onClick={() => setPending({ type: 'activate', hospital: h })}
                  className="btn btn-sm gap-1 bg-success-50 text-success-700 border-success-100 hover:bg-success-100 dark:bg-success-950/30 dark:text-success-400 dark:border-success-900/50"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Reactivate
                </button>
                <button onClick={() => setPending({ type: 'delete', hospital: h })} className="btn btn-danger btn-sm gap-1">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </>
            )}
            {h.status === 'PROVISIONING' && (
              <button
                onClick={() => setPending({ type: 'delete', hospital: h })}
                className="btn btn-danger btn-sm gap-1"
                title="Abandon this stuck onboarding attempt so its slug can be retried"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Discard
              </button>
            )}
          </div>
        )}
      />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
          <form onSubmit={saveEdit} className="w-full max-w-sm card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Edit {editing.name}</h2>
              <button type="button" onClick={() => setEditing(null)} className="btn btn-ghost btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            {editError && <div className="alert-danger">{editError}</div>}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Hospital name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                disabled={editSaving}
                className="input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} disabled={editSaving} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={editSaving} className="btn btn-primary">
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resetting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
          <form onSubmit={saveReset} className="w-full max-w-sm card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Reset a password in {resetting.name}</h2>
              <button type="button" onClick={() => setResetting(null)} className="btn btn-ghost btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            {resetError && <div className="alert-danger">{resetError}</div>}
            {resetSuccess && <div className="alert-success">{resetSuccess}</div>}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Login identifier</label>
              <input
                type="text"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                required
                disabled={resetSaving}
                placeholder="administrator@..."
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">New password</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={8}
                disabled={resetSaving}
                className="input"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetting(null)} disabled={resetSaving} className="btn btn-secondary">
                Close
              </button>
              <button type="submit" disabled={resetSaving} className="btn btn-primary">
                {resetSaving ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pending && pending.type !== 'delete' && (
        <ConfirmModal
          title={pending.type === 'suspend' ? `Suspend ${pending.hospital.name}?` : `Reactivate ${pending.hospital.name}?`}
          message={
            pending.type === 'suspend'
              ? 'Its staff will immediately be unable to log in, and the Super Admin will no longer be able to enter it either, until it is reactivated.'
              : 'Its staff will be able to log in again immediately.'
          }
          confirmLabel={pending.type === 'suspend' ? 'Suspend' : 'Reactivate'}
          danger={pending.type === 'suspend'}
          busy={actionBusy}
          onConfirm={runPendingAction}
          onCancel={() => setPending(null)}
        />
      )}

      {pending && pending.type === 'delete' && (
        <ConfirmModal
          title={
            pending.hospital.status === 'PROVISIONING'
              ? `Discard stuck onboarding attempt for ${pending.hospital.name}?`
              : `Permanently delete ${pending.hospital.name}?`
          }
          message={
            pending.hospital.status === 'PROVISIONING'
              ? `Onboarding for "${pending.hospital.slug}" never completed. This drops whatever partial schema was created and frees the identifier so it can be retried. There is no live patient data to lose here.`
              : 'This drops its entire database schema. All of its patients, visits, billing and inventory data is gone forever. This cannot be undone.'
          }
          confirmLabel={pending.hospital.status === 'PROVISIONING' ? 'Discard' : 'Delete Forever'}
          danger
          busy={actionBusy}
          onConfirm={runPendingAction}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};
