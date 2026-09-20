import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  Loader2,
  Plus,
  Pencil,
  Ban,
  RotateCcw,
  X,
  KeyRound,
  Lock,
  Unlock,
  Search,
  Info,
  Mail,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { ConfirmModal } from '../components/ConfirmModal';
import { AccountCreatedModal } from '../components/AccountCreatedModal';
import { CreateDefaultRolesModal } from '../components/CreateDefaultRolesModal';
import {
  fetchAllStaffForAdmin,
  createStaff,
  updateStaff,
  setStaffActive,
  resetStaffPassword,
  setStaffLocked,
  resendStaffActivation,
  StaffProfile,
  StaffRole,
  STAFF_ROLES,
} from '../api/staff.api';
import { WeeklyScheduleEntry } from '../api/doctor.api';
import { fetchDepartments, Department } from '../api/opd.api';
import { WeeklyScheduleEditor } from '../components/WeeklyScheduleEditor';
import { defaultSchedule, formatDate } from '../utils/weeklySchedule';

const ROLE_LABELS: Record<StaffRole, string> = {
  Reception: 'Receptionist',
  AdmissionDesk: 'Admission Desk',
  Nurse: 'Nurse',
  Pharmacist: 'Pharmacist',
  StoreManager: 'Store Manager',
  ProcurementOfficer: 'Procurement Officer',
  DataEntryOperator: 'Data Entry Operator',
  Administrator: 'Hospital Administrator',
  QueueManager: 'Queue Manager',
  LabTechnician: 'Lab Technician',
  Pathologist: 'Pathologist',
  Accountant: 'Accountant',
  OPDDisplayOperator: 'OPD Display Operator',
  THERAPY_STAFF: 'Therapy / Panchakarma Staff',
};

interface StaffFormState {
  name: string;
  role: StaffRole;
  email: string;
  department: string;
  designation: string;
  contactPhone: string;
  departmentIds: string[];
  weeklySchedule: WeeklyScheduleEntry[];
}

const emptyForm = (): StaffFormState => ({
  name: '',
  role: 'Nurse',
  email: '',
  department: '',
  designation: '',
  contactPhone: '',
  departmentIds: [],
  weeklySchedule: defaultSchedule(),
});

export const StaffManagementPage: React.FC = () => {
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<StaffFormState>(emptyForm());

  const [accountCreated, setAccountCreated] = useState<{ name: string; staffId?: string; role?: string; email: string; password: string } | null>(null);

  const [pendingToggle, setPendingToggle] = useState<StaffProfile | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [pendingReset, setPendingReset] = useState<StaffProfile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [pendingLock, setPendingLock] = useState<StaffProfile | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const [showBulkModal, setShowBulkModal] = useState(false);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => undefined);
  }, []);

  const loadStaff = () => {
    setIsLoading(true);
    setError(null);
    fetchAllStaffForAdmin({
      role: roleFilter !== 'All' ? (roleFilter as StaffRole) : undefined,
      status: statusFilter ? (statusFilter as 'active' | 'inactive' | 'locked') : undefined,
      search: search.trim() || undefined,
      page,
      limit: 25,
    })
      .then((result) => {
        setStaff(result.items);
        setMeta(result.meta);
      })
      .catch((err) => setError(err.message || 'Error loading staff'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(loadStaff, 250); // debounce the search box
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, statusFilter, search, page]);

  const updateFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setSaveError(null);
    setShowModal(true);
  };

  const openEdit = (s: StaffProfile) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      role: s.role,
      email: s.email,
      department: s.department,
      designation: s.designation ?? '',
      contactPhone: s.contactPhone ?? '',
      departmentIds: s.departments.map((d) => d.id),
      weeklySchedule: s.weeklySchedule.length === 7 ? s.weeklySchedule : defaultSchedule(),
    });
    setSaveError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await updateStaff(editingId, {
          name: form.name,
          email: form.email,
          department: form.department,
          designation: form.designation || undefined,
          contactPhone: form.contactPhone || undefined,
          departmentIds: form.departmentIds,
          weeklySchedule: form.weeklySchedule,
        });
        setShowModal(false);
        loadStaff();
      } else {
        const created = await createStaff({
          name: form.name,
          role: form.role,
          email: form.email,
          department: form.department,
          designation: form.designation || undefined,
          contactPhone: form.contactPhone || undefined,
          departmentIds: form.departmentIds.length > 0 ? form.departmentIds : undefined,
          weeklySchedule: form.weeklySchedule,
        });
        setShowModal(false);
        setAccountCreated({
          name: created.name,
          staffId: created.staffId ?? undefined,
          role: ROLE_LABELS[created.role],
          email: created.email,
          password: created.temporaryPassword,
        });
        loadStaff();
      }
    } catch (err: unknown) {
      setSaveError((err as Error).message || 'Failed to save staff member');
    } finally {
      setSaving(false);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    try {
      await setStaffActive(pendingToggle.id, !pendingToggle.active);
      setPendingToggle(null);
      loadStaff();
    } catch (err: unknown) {
      setToggleError((err as Error).message || 'Failed to update staff member');
    } finally {
      setToggling(false);
    }
  };

  const confirmReset = async () => {
    if (!pendingReset) return;
    setResetting(true);
    setResetError(null);
    try {
      const result = await resetStaffPassword(pendingReset.id);
      setPendingReset(null);
      setAccountCreated({
        name: pendingReset.name,
        role: ROLE_LABELS[pendingReset.role],
        email: result.email,
        password: result.temporaryPassword,
      });
      loadStaff();
    } catch (err: unknown) {
      setResetError((err as Error).message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const confirmLock = async () => {
    if (!pendingLock) return;
    setLocking(true);
    setLockError(null);
    try {
      await setStaffLocked(pendingLock.id, !pendingLock.locked);
      setPendingLock(null);
      loadStaff();
    } catch (err: unknown) {
      setLockError((err as Error).message || 'Failed to update account lock');
    } finally {
      setLocking(false);
    }
  };

  const handleResendActivation = async (id: string) => {
    setResendingId(id);
    setResendMessage(null);
    try {
      await resendStaffActivation(id);
      setResendMessage('Activation email resent.');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to resend activation email');
    } finally {
      setResendingId(null);
    }
  };

  const groupedStaff = useMemo(() => {
    const groups: Record<string, StaffProfile[]> = {};
    staff.forEach((s) => {
      if (!groups[s.role]) groups[s.role] = [];
      groups[s.role].push(s);
    });
    return groups;
  }, [staff]);

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-6xl">
      <div className="card p-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary-600" />
            Staff Management
          </h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Doctor accounts are managed on the Doctor Schedule screen.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => updateFilter(setSearch)(e.target.value)}
              placeholder="Name, email, staff ID, department..."
              className="input text-sm py-2 pl-8 w-64"
            />
          </div>
          <select value={roleFilter} onChange={(e) => updateFilter(setRoleFilter)(e.target.value)} className="input text-sm py-2">
            <option value="All">All Roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => updateFilter(setStatusFilter)(e.target.value)} className="input text-sm py-2">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="locked">Locked</option>
          </select>
          <button onClick={openCreate} className="btn btn-primary btn-sm whitespace-nowrap gap-2">
            <Plus className="w-4 h-4" /> Add Staff
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="btn btn-secondary btn-sm whitespace-nowrap gap-2"
            title="Create one login-ready account per default role with a single initial password"
          >
            <Users className="w-4 h-4" /> Create Roles Automatically
          </button>
        </div>
      </div>

      {error && <div className="alert-danger">{error}</div>}
      {toggleError && <div className="alert-danger">{toggleError}</div>}
      {resetError && <div className="alert-danger">{resetError}</div>}
      {lockError && <div className="alert-danger">{lockError}</div>}
      {resendMessage && <div className="alert-success">{resendMessage}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedStaff).map(([role, members]) => (
            <div key={role} className="space-y-4">
              <div className="flex items-center gap-2 border-b-2 border-primary-100 dark:border-primary-900 pb-2">
                <h2 className="text-lg font-bold text-primary-900 dark:text-primary-100">
                  {ROLE_LABELS[role as StaffRole] ?? role}
                </h2>
                <Badge variant="neutral">{members.length}</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {members.map((s) => (
                  <div
                    key={s.id}
                    className={`card p-4 hover:shadow-md transition-shadow border-l-4 flex flex-col justify-between h-full ${
                      s.active ? 'border-primary-500' : 'border-[var(--color-border)] opacity-70'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{s.name}</h3>
                        <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-semibold mt-1">
                          {s.staffId ?? '—'}
                        </p>
                      </div>
                      <Badge variant={s.locked ? 'danger' : s.active ? 'success' : 'neutral'}>
                        {s.locked ? 'LOCKED' : s.active ? 'ACTIVE' : 'INACTIVE'}
                      </Badge>
                    </div>

                    <div className="text-xs text-[var(--color-text-secondary)] space-y-1 mb-2">
                      <p>{s.email}</p>
                      <p>
                        {s.department}
                        {s.designation ? ` • ${s.designation}` : ''}
                      </p>
                      {s.contactPhone && <p>{s.contactPhone}</p>}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)] pt-2 border-t border-[var(--color-border)]">
                      <span>Password changed: {formatDate(s.passwordChangedAt)}</span>
                      <span>Last login: {formatDate(s.lastLoginAt)}</span>
                    </div>

                    <div className="pt-3 mt-1 flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => openEdit(s)} className="btn btn-secondary btn-sm gap-1">
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button onClick={() => setPendingReset(s)} className="btn btn-secondary btn-sm gap-1">
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset Password
                      </button>
                      <button onClick={() => setPendingLock(s)} className="btn btn-secondary btn-sm gap-1">
                        {s.locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        {s.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button onClick={() => setPendingToggle(s)} className="btn btn-secondary btn-sm gap-1">
                        {s.active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {s.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      {s.mustChangePassword && (
                        <button
                          onClick={() => handleResendActivation(s.id)}
                          disabled={resendingId === s.id}
                          className="btn btn-secondary btn-sm gap-1"
                          title="Resend the account-activation email"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {resendingId === s.id ? 'Sending...' : 'Resend Activation'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(groupedStaff).length === 0 && (
            <div className="card p-12 text-center text-[var(--color-text-tertiary)]">
              No staff found for the selected filters.
            </div>
          )}

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-tertiary)]">
                {meta.total} total staff • Page {page} of {meta.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn btn-secondary btn-sm gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page >= meta.totalPages}
                  className="btn btn-secondary btn-sm gap-1"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-backdrop">
          <div className="card w-full max-w-lg p-6 animate-scale-in max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingId ? `Edit ${form.name}` : 'Add New Staff Member'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Name</label>
                  <input
                    required
                    type="text"
                    className="input w-full"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Role</label>
                  <select
                    required
                    disabled={!!editingId}
                    className="input w-full disabled:opacity-60"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
                  >
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  {editingId && (
                    <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">Role cannot be changed after creation.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Email (login identifier)</label>
                  <input
                    required
                    type="email"
                    className="input w-full"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="jane.doe@esic.gov.in"
                  />
                  {editingId && (
                    <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                      Changing this updates their login identifier immediately.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Department / Ward</label>
                  <input
                    required
                    type="text"
                    className="input w-full"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    placeholder="General Ward"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold mb-1">
                    Assigned Department(s) <span className="font-normal text-[var(--color-text-tertiary)]">(optional, structured)</span>
                  </label>
                  <select
                    multiple
                    className="input w-full h-24"
                    value={form.departmentIds}
                    onChange={(e) =>
                      setForm({ ...form, departmentIds: Array.from(e.target.selectedOptions, (o) => o.value) })
                    }
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                    Ctrl/Cmd-click to select multiple. The first selected becomes the primary department.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Designation</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    placeholder="Staff Nurse"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Contact Phone</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={form.contactPhone}
                    onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>

              <WeeklyScheduleEditor
                value={form.weeklySchedule}
                onChange={(next) => setForm({ ...form, weeklySchedule: next })}
              />

              {saveError && <div className="alert-danger">{saveError}</div>}

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)] mt-4">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {accountCreated && (
        <AccountCreatedModal
          name={accountCreated.name}
          staffId={accountCreated.staffId}
          role={accountCreated.role}
          email={accountCreated.email}
          password={accountCreated.password}
          onClose={() => setAccountCreated(null)}
        />
      )}

      {showBulkModal && (
        <CreateDefaultRolesModal
          onClose={() => setShowBulkModal(false)}
          onDone={() => {
            loadStaff();
          }}
        />
      )}

      {pendingToggle && (
        <ConfirmModal
          title={pendingToggle.active ? `Deactivate ${pendingToggle.name}?` : `Reactivate ${pendingToggle.name}?`}
          message={
            pendingToggle.active
              ? 'They will no longer be able to sign in. Historical records already created by them are unaffected.'
              : 'They will be able to sign in again and reappear in staff lists.'
          }
          confirmLabel={pendingToggle.active ? 'Deactivate' : 'Reactivate'}
          danger={pendingToggle.active}
          busy={toggling}
          onConfirm={confirmToggle}
          onCancel={() => setPendingToggle(null)}
        />
      )}

      {pendingReset && (
        <ConfirmModal
          title={`Reset ${pendingReset.name}'s password?`}
          message="A new one-time password will be generated and shown once. Their current password stops working immediately, and they'll be required to change it at next login."
          confirmLabel="Reset Password"
          danger
          busy={resetting}
          onConfirm={confirmReset}
          onCancel={() => setPendingReset(null)}
        />
      )}

      {pendingLock && (
        <ConfirmModal
          title={pendingLock.locked ? `Unlock ${pendingLock.name}'s account?` : `Lock ${pendingLock.name}'s account?`}
          message={
            pendingLock.locked
              ? 'They will be able to sign in again immediately, and any automatic failed-attempt lockout is cleared too.'
              : "They will be unable to sign in until an administrator unlocks the account again, regardless of their password."
          }
          confirmLabel={pendingLock.locked ? 'Unlock' : 'Lock'}
          danger={!pendingLock.locked}
          busy={locking}
          onConfirm={confirmLock}
          onCancel={() => setPendingLock(null)}
        />
      )}
    </div>
  );
};
