import React, { useState } from 'react';
import { Lock, ShieldCheck, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { activateAccount } from '../../api/auth.api';

function getTokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token') || '';
}

/**
 * Public route (/activate?token=...) reached from the activation email link
 * -- no auth context exists yet, the token itself is the credential. Single
 * use and 24h-expiring, enforced server-side.
 */
export const ActivateAccountPage: React.FC = () => {
  const [token] = useState(getTokenFromUrl);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await activateAccount(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate account');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
        <div className="card w-full max-w-md p-6 text-center space-y-3">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Invalid Activation Link</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This link is missing its activation token. Ask your administrator to resend your activation email.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
        <div className="card w-full max-w-md p-6 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-success-500/10 flex items-center justify-center text-success-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Account Activated</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your password has been set. You can now sign in with your new password.
          </p>
          <a href="/" className="btn btn-primary btn-md w-full">
            Go to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
      <div className="card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border)]">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-600">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Activate Your Account</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Choose a password to finish setting up your account. This link can only be used once.
            </p>
          </div>
        </div>

        {error && <div className="alert alert-danger text-xs">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">New Password *</label>
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
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block">Confirm Password *</label>
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
            disabled={submitting || !newPassword || !confirmPassword}
            className="btn btn-primary btn-md w-full gap-2"
          >
            {submitting ? 'Activating...' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
};
