import React, { useEffect, useState } from 'react';
import {
  fetchAllDepartmentsForAdmin,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  DepartmentRecord,
} from '../../api/department.api';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Building2, Plus, RefreshCw, Pencil, Ban, RotateCcw, X } from 'lucide-react';

interface DepartmentManagementScreenProps {
  authToken: string;
}

export const DepartmentManagementScreen: React.FC<DepartmentManagementScreenProps> = ({ authToken }) => {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<DepartmentRecord | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pendingToggle, setPendingToggle] = useState<DepartmentRecord | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDepartments(await fetchAllDepartmentsForAdmin(authToken));
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing({ id: '', name: '', code: '', active: true, createdAt: '' });
    setName('');
    setCode('');
    setSaveError(null);
  };

  const openEdit = (d: DepartmentRecord) => {
    setEditing(d);
    setName(d.name);
    setCode(d.code);
    setSaveError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.id) {
        await updateDepartment(editing.id, { name, code }, authToken);
      } else {
        await createDepartment({ name, code: code.toUpperCase() }, authToken);
      }
      setEditing(null);
      load();
    } catch (err: unknown) {
      setSaveError((err as Error).message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    try {
      await setDepartmentActive(pendingToggle.id, !pendingToggle.active, authToken);
      setPendingToggle(null);
      load();
    } catch (err: unknown) {
      setToggleError((err as Error).message || 'Failed to update department');
    } finally {
      setToggling(false);
    }
  };

  const columns: Column<DepartmentRecord>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'code', header: 'Code', render: (d) => <span className="font-mono text-xs">{d.code}</span> },
    {
      key: 'active',
      header: 'Status',
      sortable: true,
      render: (d) => <Badge variant={d.active ? 'success' : 'neutral'}>{d.active ? 'ACTIVE' : 'INACTIVE'}</Badge>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Departments</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Clinical departments offered on the OPD registration form. Deactivating one removes it from new
              registrations without touching any visit already recorded against it.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={openCreate} className="btn btn-primary btn-sm gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New Department
          </button>
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}
      {toggleError && <div className="alert-danger">{toggleError}</div>}

      {editing && (
        <form onSubmit={handleSave} className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">
              {editing.id ? `Edit ${editing.name}` : 'New Department'}
            </h2>
            <button type="button" onClick={() => setEditing(null)} className="btn btn-ghost btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>
          {saveError && <div className="alert-danger">{saveError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={saving}
                placeholder="e.g. Cardiology"
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
                pattern="[A-Z0-9_]+"
                disabled={saving}
                placeholder="e.g. CARDIO"
                className="input font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Saving...' : editing.id ? 'Save Changes' : 'Create Department'}
            </button>
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && departments.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] py-4">Loading departments...</p>
      ) : (
        <DataTable
          title="All Departments"
          data={departments}
          columns={columns}
          keyExtractor={(d) => d.id}
          searchableKey="name"
          searchPlaceholder="Search departments..."
          actions={(d) => (
            <div className="flex items-center justify-end gap-1.5">
              <button onClick={() => openEdit(d)} className="btn btn-secondary btn-sm gap-1">
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              <button onClick={() => setPendingToggle(d)} className="btn btn-secondary btn-sm gap-1">
                {d.active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {d.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          )}
        />
      )}

      {pendingToggle && (
        <ConfirmModal
          title={pendingToggle.active ? `Deactivate ${pendingToggle.name}?` : `Reactivate ${pendingToggle.name}?`}
          message={
            pendingToggle.active
              ? 'It will no longer appear on the OPD registration form. Blocked if this is the only remaining active department. Existing visits recorded against it are unaffected.'
              : 'It will appear on the OPD registration form again immediately.'
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
