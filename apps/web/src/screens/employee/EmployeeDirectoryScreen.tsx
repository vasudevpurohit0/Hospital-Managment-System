import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchAllEmployees,
  createEmployeeSimple,
  updateEmployeeContact,
  fetchPostGradeOptions,
  EmployeeDirectoryRecord,
} from '../../api/employee.api';
import { UserPlus, Search, Edit2, X, Upload } from 'lucide-react';
import { BulkImportPanel } from './BulkImportPanel';

interface EmployeeDirectoryScreenProps {
  authToken: string;
}

/**
 * The Data Entry Operator's own working screen — this role is strictly
 * scoped to Employee:create/update (FR-SEC-13) but previously had nowhere
 * in the UI to actually do that job. This is a plain directory: search,
 * add a new employee record, and edit contact/department details.
 */
export const EmployeeDirectoryScreen: React.FC<EmployeeDirectoryScreenProps> = ({ authToken }) => {
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newGradePayLevel, setNewGradePayLevel] = useState('');
  const [newEmploymentType, setNewEmploymentType] = useState<'PERMANENT' | 'CONTRACTUAL'>('PERMANENT');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [postOptions, setPostOptions] = useState<string[]>([]);
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchPostGradeOptions(authToken)
      .then(({ posts, grades }) => {
        setPostOptions(posts);
        setGradeOptions(grades);
      })
      .catch(() => {
        // Non-fatal: the Post/Designation and Grade/Pay Level fields simply
        // fall back to plain free-typing if the suggestion list can't load.
      });
  }, [authToken]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllEmployees(authToken);
      setEmployees(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const resetAddForm = () => {
    setNewEmployeeId('');
    setNewName('');
    setNewDepartment('');
    setNewPostTitle('');
    setNewGradePayLevel('');
    setNewEmploymentType('PERMANENT');
    setNewContactPhone('');
    setNewContactEmail('');
    setFormError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployeeId.trim() || !newName.trim() || !newDepartment.trim() || !newPostTitle.trim() || !newGradePayLevel.trim()) {
      setFormError('Employee ID, Name, Department, Post and Grade are all required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createEmployeeSimple(
        {
          employeeId: newEmployeeId.trim(),
          name: newName.trim(),
          department: newDepartment.trim(),
          postTitle: newPostTitle.trim(),
          gradePayLevel: newGradePayLevel.trim(),
          employmentTypeCode: newEmploymentType,
          contactPhone: newContactPhone.trim() || undefined,
          contactEmail: newContactEmail.trim() || undefined,
        },
        authToken,
      );
      resetAddForm();
      setShowAddForm(false);
      await loadEmployees();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create employee');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (emp: EmployeeDirectoryRecord) => {
    setEditingId(emp.id);
    setEditName(emp.name);
    setEditDepartment(emp.department);
    setEditContactPhone(emp.contactPhone || '');
    setEditContactEmail(emp.contactEmail || '');
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    try {
      await updateEmployeeContact(
        id,
        {
          name: editName.trim(),
          department: editDepartment.trim(),
          contactPhone: editContactPhone.trim(),
          contactEmail: editContactEmail.trim(),
        },
        authToken,
      );
      setEditingId(null);
      await loadEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update employee');
    } finally {
      setSaving(false);
    }
  };

  const filtered = employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      e.employeeId.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary-500" />
            Employee Directory
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Add and update government employee master records (name, department, contact details).
            This does not register them as a hospital patient — use Registration for that.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-secondary btn-md gap-1.5"
            onClick={() => setShowBulkImport((v) => !v)}
          >
            <Upload className="w-4 h-4" />
            {showBulkImport ? 'Close Bulk Import' : 'Bulk Import Employees'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-md gap-1.5"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <UserPlus className="w-4 h-4" />
            {showAddForm ? 'Cancel' : '+ Add Employee'}
          </button>
        </div>
      </div>

      {showBulkImport && (
        <BulkImportPanel
          authToken={authToken}
          onImported={() => {
            loadEmployees();
          }}
        />
      )}

      {showAddForm && (
        <form onSubmit={handleCreate} className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">New Employee Record</h3>
          {formError && <div className="alert alert-danger text-xs">{formError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Employee ID *</label>
              <input className="input text-xs py-2 w-full" value={newEmployeeId} onChange={(e) => setNewEmployeeId(e.target.value)} placeholder="EMP-1003" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Full Name *</label>
              <input className="input text-xs py-2 w-full" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Employee's full name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Department *</label>
              <input className="input text-xs py-2 w-full" value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} placeholder="e.g. Public Works Department" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Post / Designation *</label>
              <input
                className="input text-xs py-2 w-full"
                value={newPostTitle}
                onChange={(e) => setNewPostTitle(e.target.value)}
                placeholder="e.g. Clerk"
                list="post-title-options"
              />
              <datalist id="post-title-options">
                {postOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Grade / Pay Level *</label>
              <input
                className="input text-xs py-2 w-full"
                value={newGradePayLevel}
                onChange={(e) => setNewGradePayLevel(e.target.value)}
                placeholder="e.g. Pay Level 4"
                list="grade-pay-level-options"
              />
              <datalist id="grade-pay-level-options">
                {gradeOptions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Employment Type *</label>
              <select className="input text-xs py-2 w-full" value={newEmploymentType} onChange={(e) => setNewEmploymentType(e.target.value as 'PERMANENT' | 'CONTRACTUAL')}>
                <option value="PERMANENT">Permanent</option>
                <option value="CONTRACTUAL">Contractual</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Contact Phone</label>
              <input className="input text-xs py-2 w-full" value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} placeholder="+91 9XXXXXXXXX" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">Contact Email</label>
              <input className="input text-xs py-2 w-full" value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} placeholder="name@labour.gov.in" />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn btn-primary btn-md">
            {saving ? 'Saving...' : 'Save Employee Record'}
          </button>
        </form>
      )}

      <div className="card p-5 space-y-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            className="input input-with-icon text-xs py-2 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Employee ID, name or department..."
          />
        </div>

        {error && <div className="alert alert-danger text-xs">{error}</div>}

        {loading ? (
          <p className="text-xs text-[var(--color-text-tertiary)] py-6 text-center">Loading employees…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] py-6 text-center">No employees found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-max min-w-full text-xs">
              <thead>
                <tr className="text-left border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  <th className="py-2 pr-3">Employee ID</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Post / Grade</th>
                  <th className="py-2 pr-3">Contact</th>
                  <th className="py-2 pr-3">Hospital UID</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="border-b border-[var(--color-border)]">
                    {editingId === emp.id ? (
                      <>
                        <td className="py-2 pr-3 font-mono">{emp.employeeId}</td>
                        <td className="py-2 pr-3">
                          <input className="input text-xs py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </td>
                        <td className="py-2 pr-3">
                          <input className="input text-xs py-1 w-full" value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} />
                        </td>
                        <td className="py-2 pr-3">{emp.post?.title} ({emp.grade?.payLevel})</td>
                        <td className="py-2 pr-3 space-y-1">
                          <input className="input text-xs py-1 w-full" value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} placeholder="Phone" />
                          <input className="input text-xs py-1 w-full" value={editContactEmail} onChange={(e) => setEditContactEmail(e.target.value)} placeholder="Email" />
                        </td>
                        <td className="py-2 pr-3 font-mono">{emp.hospitalUid?.uidCode || '—'}</td>
                        <td className="py-2 pr-3 flex gap-1.5">
                          <button onClick={() => handleSaveEdit(emp.id)} disabled={saving} className="btn btn-primary btn-sm text-[10px]">Save</button>
                          <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm text-[10px]"><X className="w-3 h-3" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-3 font-mono">{emp.employeeId}</td>
                        <td className="py-2 pr-3 font-semibold">{emp.name}</td>
                        <td className="py-2 pr-3">{emp.department}</td>
                        <td className="py-2 pr-3">{emp.post?.title || '—'} ({emp.grade?.payLevel || '—'})</td>
                        <td className="py-2 pr-3">
                          <div>{emp.contactPhone || '—'}</div>
                          <div className="text-[var(--color-text-tertiary)]">{emp.contactEmail || '—'}</div>
                        </td>
                        <td className="py-2 pr-3 font-mono">{emp.hospitalUid?.uidCode || 'Not registered as patient'}</td>
                        <td className="py-2 pr-3">
                          <button onClick={() => startEdit(emp)} className="btn btn-secondary btn-sm text-[10px] gap-1">
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
