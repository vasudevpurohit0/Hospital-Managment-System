import React, { useState } from 'react';
import { X, Lock, Eye, EyeOff, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { changePassword } from '../api/auth.api';

interface ProfileModalProps {
  onClose: () => void;
}

/** "My Profile" from the top-nav dropdown -- read-only account details plus a self-service change-password form, reusing the same POST /auth/change-password flow as ForcedChangePasswordScreen. */
export const ProfileModal: React.FC<ProfileModalProps> = ({ onClose }) => {
  const { user, mode, activeHospital } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
      <div className="w-full max-w-md card p-6 space-y-5 animate-scale-in">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">My Profile</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-500/10 flex items-center justify-center text-base font-bold text-primary-500 flex-shrink-0">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{user?.name}</p>
            <p className="text-xs text-[var(--color-text-secondary)] truncate">{user?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Role</p>
            <p className="text-[var(--color-text-primary)] font-medium">{user?.role}</p>
          </div>
          {user?.department && (
            <div>
              <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Department</p>
              <p className="text-[var(--color-text-primary)] font-medium">{user.department}</p>
            </div>
          )}
          {mode === 'platform' ? (
            <div>
              <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Hospital</p>
              <p className="text-[var(--color-text-primary)] font-medium">
                {activeHospital?.name || 'Platform-wide'}
              </p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Change Password</h3>

          {error && <div className="alert alert-danger text-xs">{error}</div>}
          {success && (
            <div className="alert alert-success text-xs flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Password changed successfully.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">
                Current Password
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
                New Password
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
                Confirm New Password
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
              {submitting ? 'Changing Password...' : 'Change Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
