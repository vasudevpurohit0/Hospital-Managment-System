import React, { useState } from 'react';
import { createHospital, CreateHospitalResult } from '../../api/platform.api';
import { Building2, PlusCircle, Copy, Check, X, AlertTriangle } from 'lucide-react';

interface CreateHospitalScreenProps {
  onCreated: () => void;
  onCancel: () => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Shown exactly once, immediately after a hospital is onboarded -- lists
 * every account the platform just auto-created (the Administrator plus the
 * default non-Doctor role roster), all sharing the one initial password the
 * Super Admin just typed into the form. Nothing here is persisted
 * client-side; once closed, the plaintext password is gone from memory for
 * good, same guarantee as AccountCreatedModal for a single staff account.
 */
function HospitalCreatedModal({
  hospital,
  password,
  onClose,
}: {
  hospital: CreateHospitalResult;
  password: string;
  onClose: () => void;
}) {
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const accounts = [{ role: 'Administrator', identifier: hospital.adminIdentifier }, ...hospital.roleAccounts.created];

  const copyPassword = async () => {
    await navigator.clipboard.writeText(password);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  const copyAll = async () => {
    const lines = [
      `Hospital: ${hospital.name}`,
      `Initial password (all accounts below): ${password}`,
      '',
      ...accounts.map((a) => `${a.role}: ${a.identifier}`),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
      <div className="w-full max-w-lg card p-6 space-y-5 animate-scale-in max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Hospital Onboarded — Save These Credentials</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="alert-warning flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>This password is shown only once. Every account below is active now and must change it on first login.</span>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Initial Password (shared by every account below)</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={password} onFocus={(e) => e.target.select()} className="input font-mono flex-1" />
            <button onClick={copyPassword} className="btn btn-secondary btn-icon flex-shrink-0" title="Copy password">
              {copiedPassword ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">
            {accounts.length} account{accounts.length === 1 ? '' : 's'} created for {hospital.name}
          </p>
          <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] max-h-64 overflow-y-auto">
            {accounts.map((a) => (
              <div key={a.identifier} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-[var(--color-text-primary)]">{a.role}</span>
                <span className="font-mono text-xs text-[var(--color-text-secondary)] break-all text-right">{a.identifier}</span>
              </div>
            ))}
          </div>
        </div>

        {hospital.roleAccounts.failed.length > 0 && (
          <div className="alert-danger text-xs">
            {hospital.roleAccounts.failed.length} role account(s) failed to create:{' '}
            {hospital.roleAccounts.failed.map((f) => `${f.role} (${f.reason})`).join(', ')}. You can retry these later
            from Staff Management's "Create Roles Automatically".
          </div>
        )}

        <button onClick={copyAll} className="btn btn-secondary w-full gap-2">
          {copiedAll ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
          {copiedAll ? 'All Credentials Copied' : 'Copy All Logins + Password'}
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
}

export const CreateHospitalScreen: React.FC<CreateHospitalScreenProps> = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ hospital: CreateHospitalResult; password: string } | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const passwordsMatch = initialPassword.length > 0 && initialPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (initialPassword !== confirmPassword) {
      setError('Initial password and confirmation do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const hospital = await createHospital({ name, slug, adminIdentifier, initialPassword, confirmPassword });
      // Shown once, immediately -- same reasoning as AccountCreatedModal
      // after staff creation. This password was chosen right here in this
      // form by the Super Admin, so nothing new is exposed; this just stops
      // it from being silently lost the moment the form clears on success.
      setCreated({ hospital, password: initialPassword });
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to onboard hospital');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div className="card p-6 flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary-50 border border-primary-100 text-primary-600 dark:bg-primary-950/30 dark:border-primary-900/50 dark:text-primary-400">
          <PlusCircle className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Onboard a New Hospital</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Creates the hospital's own database schema, runs its migrations, and creates its Administrator plus a
            default set of role accounts (Nurse, Receptionist, Pharmacist, Lab Technician, Admission Desk, Data Entry
            Operator, etc. -- never Doctor, which the hospital's own Administrator adds afterward). No email is
            required for any of this. This can take a little while.
          </p>
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Hospital name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            disabled={saving}
            placeholder="e.g. Apollo Chennai"
            className="input"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Identifier suffix (slug)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            disabled={saving}
            placeholder="apollo-chennai"
            className="input font-mono"
          />
          <p className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-1.5">
            <Building2 className="w-3 h-3" />
            Used internally to name this hospital's database schema, and as the domain for every auto-created login
            (e.g. nurse@{slug || 'apollo-chennai'}.esic.gov.in). Lowercase letters, numbers and hyphens only.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)]">First admin's login identifier</label>
          <input
            type="text"
            value={adminIdentifier}
            onChange={(e) => setAdminIdentifier(e.target.value)}
            required
            disabled={saving}
            placeholder="administrator@apollo-chennai.local"
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Initial password</label>
            <input
              type="password"
              value={initialPassword}
              onChange={(e) => setInitialPassword(e.target.value)}
              required
              minLength={8}
              disabled={saving}
              placeholder="Minimum 8 characters"
              className="input"
            />
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              Shared by the Administrator and every auto-created role account. Each gets its own password hash, and
              every account is forced to set its own personal password on first login.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              disabled={saving}
              placeholder="Re-enter the initial password"
              className="input"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-[11px] text-danger-600">Passwords do not match.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !slug.trim() || !adminIdentifier.trim() || !passwordsMatch}
            className="btn btn-primary"
          >
            {saving ? 'Onboarding...' : 'Onboard Hospital'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>

      {created && (
        <HospitalCreatedModal
          hospital={created.hospital}
          password={created.password}
          onClose={() => {
            setCreated(null);
            onCreated();
          }}
        />
      )}
    </div>
  );
};
