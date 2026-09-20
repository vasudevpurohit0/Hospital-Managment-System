import React, { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2, KeyRound } from 'lucide-react';
import {
  fetchDefaultRolesStatus,
  createDefaultRoles,
  DefaultRoleStatus,
  DefaultRolesResult,
} from '../api/staff.api';

interface CreateDefaultRolesModalProps {
  onClose: () => void;
  /** Refresh the staff list behind the modal after accounts are created. */
  onDone: () => void;
}

/**
 * "Create Roles Automatically" -- bulk-provisions one login-ready account per
 * default hospital role with a single admin-chosen initial password.
 *
 * No activation email is involved: the identifiers are system login ids, not
 * real mailboxes. Existing accounts are shown as EXISTS, unchecked and
 * disabled -- re-running only creates what is still missing. The password is
 * never displayed after creation (only the usernames are listed).
 */
export const CreateDefaultRolesModal: React.FC<CreateDefaultRolesModalProps> = ({ onClose, onDone }) => {
  const [status, setStatus] = useState<DefaultRoleStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requireChange, setRequireChange] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<DefaultRolesResult | null>(null);

  useEffect(() => {
    fetchDefaultRolesStatus()
      .then((rows) => {
        setStatus(rows);
        setSelected(new Set(rows.filter((r) => !r.exists).map((r) => r.role)));
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to fetch default roles'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (role: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const passwordsMatch = initialPassword === confirmPassword;
  const passwordValid = initialPassword.length >= 8 && initialPassword.length <= 72 && initialPassword.trim().length > 0;
  const canSubmit =
    !creating && selected.size > 0 && passwordValid && passwordsMatch && confirmPassword.length > 0;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createDefaultRoles({
        initialPassword,
        confirmPassword,
        roles: Array.from(selected),
        requirePasswordChange: requireChange,
      });
      setResult(res);
      onDone();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create role accounts');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
      <div className="w-full max-w-lg card p-6 space-y-5 animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Create Roles Automatically</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">
              One login-ready account per role, sharing the initial password you set below. Existing
              accounts are never touched.
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        ) : loadError ? (
          <div className="alert-danger">{loadError}</div>
        ) : result ? (
          <div className="space-y-4">
            <div className="alert-success flex items-start gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                {result.createdCount} new account{result.createdCount === 1 ? '' : 's'} created
                {result.skippedCount > 0 && `, ${result.skippedCount} already existed`}
                {result.failedCount > 0 && `, ${result.failedCount} failed`}.
              </span>
            </div>
            {result.created.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
                  New accounts — log in with the initial password{result.requirePasswordChange ? ' (change required on first login)' : ''}
                </p>
                <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[var(--color-surface-secondary)]">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Role</th>
                        <th className="text-left px-3 py-2 font-semibold">Username</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {result.created.map((c) => (
                        <tr key={c.role}>
                          <td className="px-3 py-2">{c.role}</td>
                          <td className="px-3 py-2 font-mono text-xs break-all">{c.identifier}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="text-xs text-[var(--color-text-secondary)]">
                <p className="font-bold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">Already existing — no change</p>
                <ul className="list-disc list-inside">
                  {result.skipped.map((s) => (
                    <li key={s.role}>
                      {s.role} <span className="font-mono">({s.identifier})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.failed.length > 0 && (
              <div className="alert-danger text-xs">
                {result.failed.map((f) => (
                  <p key={f.role}>
                    {f.role}: {f.reason}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={onClose} className="btn btn-primary btn-sm">
                Done
              </button>
            </div>
          </div>
        ) : (
          status && (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)] mb-2">
                  Roles to create
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {status.map((r) => (
                    <label
                      key={r.role}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                        r.exists
                          ? 'border-[var(--color-border)] opacity-60'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={r.exists ? false : selected.has(r.role)}
                        disabled={r.exists}
                        onChange={() => toggle(r.role)}
                      />
                      <span className="flex-1">
                        <span className="font-medium text-[var(--color-text-primary)]">{r.displayName}</span>
                        <span className="block font-mono text-[11px] text-[var(--color-text-tertiary)]">{r.identifier}</span>
                      </span>
                      {r.exists && (
                        <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">EXISTS</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Initial password</label>
                  <input
                    type="password"
                    value={initialPassword}
                    onChange={(e) => setInitialPassword(e.target.value)}
                    className="input text-sm mt-1 w-full"
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Confirm password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input text-sm mt-1 w-full"
                    placeholder="Repeat the password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-600">Passwords do not match.</p>
              )}
              {initialPassword.length > 0 && !passwordValid && (
                <p className="text-xs text-red-600">Password must be 8–72 characters and not blank.</p>
              )}

              <label className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireChange}
                  onChange={(e) => setRequireChange(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Require password change on first login
                  <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                    Recommended — each user sets their own personal password at first login.
                  </span>
                </span>
              </label>

              {createError && <div className="alert-danger">{createError}</div>}

              <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
                Accounts are active immediately — no email activation. Share the initial password in person.
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                  Cancel
                </button>
                <button type="submit" disabled={!canSubmit} className="btn btn-primary btn-sm disabled:opacity-50">
                  {creating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      Create{' '}
                      {selected.size > 0 ? `${selected.size} Account${selected.size === 1 ? '' : 's'}` : 'Accounts'}
                    </>
                  )}
                </button>
              </div>
            </form>
          )
        )}
      </div>
    </div>
  );
};
