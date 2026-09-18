import React, { useState } from 'react';
import { createHospital } from '../../api/platform.api';

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
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>➕</span> Onboard a New Hospital
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Creates the hospital's own database schema, runs its migrations and default seed data, and creates its
          first Administrator account. This can take a little while.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <span>❌</span> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-5">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-gray-700">Hospital name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            disabled={saving}
            placeholder="e.g. Apollo Chennai"
            className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-gray-700">Login code (slug)</label>
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
            className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
          />
          <p className="text-[11px] text-gray-400">
            This is what hospital staff type into the "Hospital code" field on the login screen. Lowercase letters,
            numbers and hyphens only.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-700">First admin's email / user ID</label>
            <input
              type="text"
              value={adminIdentifier}
              onChange={(e) => setAdminIdentifier(e.target.value)}
              required
              disabled={saving}
              placeholder="administrator@apollo-chennai.local"
              className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-700">First admin's password</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              minLength={8}
              disabled={saving}
              placeholder="Minimum 8 characters"
              className="w-full h-11 px-3.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !slug.trim() || !adminIdentifier.trim() || adminPassword.length < 8}
            className="px-5 h-11 bg-[#0B2545] hover:bg-[#13315C] text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-all"
          >
            {saving ? 'Onboarding…' : 'Onboard Hospital'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-5 h-11 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
