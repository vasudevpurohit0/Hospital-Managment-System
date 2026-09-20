import React, { useState } from 'react';
import { Copy, Check, X, AlertTriangle } from 'lucide-react';

interface AccountCreatedModalProps {
  name: string;
  staffId?: string;
  role?: string;
  email: string;
  password: string;
  onClose: () => void;
}

/**
 * Shown exactly once, immediately after a staff account is created or its
 * password is reset. Nothing here is ever persisted client-side (no
 * localStorage, no re-fetchable state) -- once `onClose` fires, the plain-text
 * password is gone from memory for good; there is no way to see it again
 * short of another reset.
 */
export const AccountCreatedModal: React.FC<AccountCreatedModalProps> = ({
  name,
  staffId,
  role,
  email,
  password,
  onClose,
}) => {
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);

  const copyPassword = async () => {
    await navigator.clipboard.writeText(password);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  const copyLoginDetails = async () => {
    const lines = [
      `Login: ${email}`,
      `Password: ${password}`,
      staffId ? `Staff ID: ${staffId}` : null,
      role ? `Role: ${role}` : null,
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedDetails(true);
    setTimeout(() => setCopiedDetails(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
      <div className="w-full max-w-md card p-6 space-y-5 animate-scale-in">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Account Created — Save the Password</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="alert-warning flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            This password is shown only once. Copy and share it securely with <strong>{email}</strong>.
          </span>
        </div>

        <p className="text-xs text-[var(--color-text-secondary)]">
          The account is active now — <strong>{email}</strong> can log in immediately with this password and will be asked to set their own on first login.
        </p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Staff Name</p>
            <p className="text-[var(--color-text-primary)] font-medium">{name}</p>
          </div>
          {staffId && (
            <div>
              <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Staff ID</p>
              <p className="text-[var(--color-text-primary)] font-mono">{staffId}</p>
            </div>
          )}
          {role && (
            <div>
              <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Role</p>
              <p className="text-[var(--color-text-primary)] font-medium">{role}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Email / Login ID</p>
            <p className="text-[var(--color-text-primary)] font-medium break-all">{email}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Initial Password</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={password}
              onFocus={(e) => e.target.select()}
              className="input font-mono flex-1"
            />
            <button
              onClick={copyPassword}
              className="btn btn-secondary btn-icon flex-shrink-0"
              title="Copy password"
            >
              {copiedPassword ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button onClick={copyLoginDetails} className="btn btn-secondary w-full gap-2">
          {copiedDetails ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
          {copiedDetails ? 'Login Details Copied' : 'Copy Login Details'}
        </button>

        <button
          onClick={onClose}
          className="btn w-full bg-success-500 hover:bg-success-600 text-white border-success-500 font-semibold"
        >
          Done — I've saved the password
        </button>
      </div>
    </div>
  );
};
