import React, { useEffect, useMemo, useState } from 'react';
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

interface HospitalsListScreenProps {
  onCreateHospital: () => void;
}

const STATUS_STYLES: Record<HospitalRecord['status'], string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PROVISIONING: 'bg-amber-50 text-amber-700 border-amber-200',
  SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
};

type PendingAction =
  | { type: 'suspend' | 'activate'; hospital: HospitalRecord }
  | { type: 'delete'; hospital: HospitalRecord };

export const HospitalsListScreen: React.FC<HospitalsListScreenProps> = ({ onCreateHospital }) => {
  const { enterHospital } = useAuth();
  const [hospitals, setHospitals] = useState<HospitalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter((h) => h.name.toLowerCase().includes(q) || h.slug.toLowerCase().includes(q));
  }, [hospitals, search]);

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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🏥</span> Hospitals
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every hospital on this platform. Enter one to view and manage its data directly.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            Refresh
          </button>
          <button
            onClick={onCreateHospital}
            className="px-3.5 py-2 bg-[#0B2545] hover:bg-[#13315C] text-white rounded-lg text-sm font-semibold transition-all"
          >
            + New Hospital
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {error}
        </div>
      )}
      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {actionError}
        </div>
      )}

      {hospitals.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search hospitals by name or code…"
          className="w-full max-w-sm h-11 px-3.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
        />
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading hospitals…</div>
        ) : hospitals.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No hospitals yet.{' '}
            <button onClick={onCreateHospital} className="text-[#0B2545] font-semibold underline">
              Onboard the first one
            </button>
            .
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No hospitals match "{search}".</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Login code</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => (
                  <tr key={h.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-6 py-4 font-medium text-gray-900">{h.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-600">{h.slug}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[h.status]}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">{new Date(h.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => enterHospital({ id: h.id, name: h.name })}
                          disabled={h.status !== 'ACTIVE'}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0B2545]/5 text-[#0B2545] hover:bg-[#0B2545]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          Enter →
                        </button>
                        <button
                          onClick={() => openEdit(h)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => openReset(h)}
                          disabled={h.status === 'PROVISIONING'}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          Reset Password
                        </button>
                        {h.status === 'ACTIVE' && (
                          <button
                            onClick={() => setPending({ type: 'suspend', hospital: h })}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all"
                          >
                            Suspend
                          </button>
                        )}
                        {h.status === 'SUSPENDED' && (
                          <>
                            <button
                              onClick={() => setPending({ type: 'activate', hospital: h })}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all"
                            >
                              Reactivate
                            </button>
                            <button
                              onClick={() => setPending({ type: 'delete', hospital: h })}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 transition-all"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={saveEdit} className="w-full max-w-sm bg-white rounded-xl shadow-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Edit {editing.name}</h2>
            {editError && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">{editError}</div>}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">Hospital name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                disabled={editSaving}
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={editSaving}
                className="px-4 h-10 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="px-4 h-10 rounded-lg text-sm font-semibold bg-[#0B2545] hover:bg-[#13315C] text-white disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {resetting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={saveReset} className="w-full max-w-sm bg-white rounded-xl shadow-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Reset a password in {resetting.name}</h2>
            {resetError && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">{resetError}</div>}
            {resetSuccess && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-semibold">{resetSuccess}</div>}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">User's email / user ID</label>
              <input
                type="text"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                required
                disabled={resetSaving}
                placeholder="administrator@..."
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">New password</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={8}
                disabled={resetSaving}
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetting(null)}
                disabled={resetSaving}
                className="px-4 h-10 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={resetSaving}
                className="px-4 h-10 rounded-lg text-sm font-semibold bg-[#0B2545] hover:bg-[#13315C] text-white disabled:opacity-50"
              >
                {resetSaving ? 'Resetting…' : 'Reset Password'}
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
          title={`Permanently delete ${pending.hospital.name}?`}
          message="This drops its entire database schema. All of its patients, visits, billing and inventory data is gone forever. This cannot be undone."
          confirmLabel="Delete Forever"
          danger
          busy={actionBusy}
          onConfirm={runPendingAction}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};
