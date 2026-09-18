import React, { useEffect, useState } from 'react';
import {
  listPlatformAdmins,
  createPlatformAdmin,
  setPlatformAdminActive,
  PlatformAdminRecord,
} from '../../api/platform.api';
import { useAuth } from '../../hooks/useAuth';
import { ConfirmModal } from '../../components/ConfirmModal';

export const PlatformAdminsScreen: React.FC = () => {
  const { user } = useAuth();
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

  useEffect(() => {
    load();
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🛡️</span> Platform Admins
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Super Admin accounts that can see and manage every hospital on this platform.
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
            onClick={() => setShowCreate(true)}
            className="px-3.5 py-2 bg-[#0B2545] hover:bg-[#13315C] text-white rounded-lg text-sm font-semibold transition-all"
          >
            + New Admin
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {error}
        </div>
      )}
      {toggleError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {toggleError}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
          {createError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">
              {createError}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={creating}
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={creating}
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={creating}
                className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B2545]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-5 h-10 bg-[#0B2545] hover:bg-[#13315C] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Admin'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={creating}
              className="px-5 h-10 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const isSelf = a.email === user?.email;
                return (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {a.name} {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{a.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          a.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}
                      >
                        {a.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setPendingToggle(a)}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        {a.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
    </div>
  );
};
