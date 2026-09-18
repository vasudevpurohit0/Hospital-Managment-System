import React, { useState } from 'react';
import { createHospital } from '../../api/platform.api';
import { Building2, PlusCircle } from 'lucide-react';

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

export const CreateHospitalScreen: React.FC<CreateHospitalScreenProps> = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createHospital({ name, slug, adminIdentifier, adminPassword });
      onCreated();
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
            Creates the hospital's own database schema, runs its migrations and default seed data, and creates its
            first Administrator account. This can take a little while.
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
            Used internally to name this hospital's database schema. Lowercase letters, numbers and hyphens only.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)]">First admin's password</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              minLength={8}
              disabled={saving}
              placeholder="Minimum 8 characters"
              className="input"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !slug.trim() || !adminIdentifier.trim() || adminPassword.length < 8}
            className="btn btn-primary"
          >
            {saving ? 'Onboarding...' : 'Onboard Hospital'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
