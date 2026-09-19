import React, { useState } from 'react';
import { Lock, ShieldCheck, LogOut, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { changePassword } from '../../api/auth.api';

/**
 * Gates the entire app for a hospital-staff session with `mustChangePassword`
 * set -- mirrors the backend's own RbacGuard allowlist, which rejects every
 * route except this one until the password is changed. Shown after first
 * login on a newly-created account, and after any admin-triggered reset.
 */
export const ForcedChangePasswordScreen: React.FC = () => {
  const { user, logout, clearMustChangePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      clearMustChangePassword();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
      <div className="card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border)]">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-600">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Change Your Password</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {user?.name ? `Welcome, ${user.name}. ` : ''}For security, you must set a new password before continuing.
            </p>
          </div>
        </div>

        {error && <div className="alert alert-danger text-xs">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">
              Current (Temporary) Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={submitting}
                className="input text-sm py-2.5 pl-9 w-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">
              New Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                disabled={submitting}
                className="input text-sm py-2.5 pl-9 w-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">
              Confirm New Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                disabled={submitting}
                className="input text-sm py-2.5 pl-9 w-full"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded border-[var(--color-border-strong)]"
            />
            <span className="flex items-center gap-1">
              {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              Show passwords
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
            className="btn btn-primary btn-md w-full gap-2"
          >
            {submitting ? 'Changing Password...' : 'Set New Password & Continue'}
          </button>

          <button
            type="button"
            onClick={logout}
            className="btn btn-ghost btn-sm w-full gap-1.5 text-xs text-[var(--color-text-secondary)]"
          >
            <LogOut className="w-3.5 h-3.5" /> Log Out Instead
          </button>
        </form>
      </div>
    </div>
  );
};
