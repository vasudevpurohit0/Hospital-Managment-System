import React, { useState, useMemo, useEffect } from 'react';
import { Clock, Calendar, Stethoscope, Loader2, Plus, Pencil, Ban, RotateCcw, X, IndianRupee, Building2 } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { ConfirmModal } from '../components/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import {
  fetchDoctors,
  fetchAllDoctorsForAdmin,
  createDoctor,
  updateDoctor,
  setDoctorActive,
  DoctorProfile,
  WeeklyScheduleEntry,
  WeekDay,
  WEEK_DAYS,
} from '../api/doctor.api';
import { fetchDepartments, Department } from '../api/opd.api';

const DAY_LABELS: Record<WeekDay, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

function defaultSchedule(): WeeklyScheduleEntry[] {
  return WEEK_DAYS.map((day) => ({
    day,
    startTime: '09:00',
    endTime: '17:00',
    available: day !== 'SAT' && day !== 'SUN',
  }));
}

function scheduleSummary(schedule: WeeklyScheduleEntry[] | null): string {
  if (!schedule || schedule.length === 0) return 'No schedule set';
  const active = schedule.filter((e) => e.available);
  if (active.length === 0) return 'Unavailable all week';
  if (active.length === 7) return `Daily, ${active[0].startTime} - ${active[0].endTime}`;
  return `${active.length} day${active.length === 1 ? '' : 's'}/week, ${active[0].startTime} - ${active[0].endTime}`;
}

interface WeeklyScheduleEditorProps {
  value: WeeklyScheduleEntry[];
  onChange: (next: WeeklyScheduleEntry[]) => void;
}

const WeeklyScheduleEditor: React.FC<WeeklyScheduleEditorProps> = ({ value, onChange }) => {
  const update = (day: WeekDay, patch: Partial<WeeklyScheduleEntry>) => {
    onChange(value.map((e) => (e.day === day ? { ...e, ...patch } : e)));
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Weekly Schedule</label>
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        {value.map((entry) => (
          <div
            key={entry.day}
            className="flex items-center gap-3 px-3 py-2 border-b border-[var(--color-border)] last:border-0 text-sm"
          >
            <label className="flex items-center gap-2 w-32 flex-shrink-0">
              <input
                type="checkbox"
                checked={entry.available}
                onChange={(e) => update(entry.day, { available: e.target.checked })}
              />
              <span className="font-medium text-[var(--color-text-primary)]">{DAY_LABELS[entry.day]}</span>
            </label>
            <input
              type="time"
              value={entry.startTime}
              onChange={(e) => update(entry.day, { startTime: e.target.value })}
              disabled={!entry.available}
              className="input py-1 text-xs w-28 disabled:opacity-40"
            />
            <span className="text-[var(--color-text-tertiary)]">to</span>
            <input
              type="time"
              value={entry.endTime}
              onChange={(e) => update(entry.day, { endTime: e.target.value })}
              disabled={!entry.available}
              className="input py-1 text-xs w-28 disabled:opacity-40"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

interface DoctorFormState {
  name: string;
  email: string;
  specialty: string;
  experience: string;
  departmentId: string;
  consultationFee: string;
  weeklySchedule: WeeklyScheduleEntry[];
}

const emptyForm = (): DoctorFormState => ({
  name: '',
  email: '',
  specialty: '',
  experience: '',
  departmentId: '',
  consultationFee: '',
  weeklySchedule: defaultSchedule(),
});

export const DoctorSchedulePage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Administrator' || user?.role === 'SuperAdmin';

  const [filterSpecialty, setFilterSpecialty] = useState<string>('All');
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [form, setForm] = useState<DoctorFormState>(emptyForm());

  const [pendingToggle, setPendingToggle] = useState<DoctorProfile | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const loadDoctors = () => {
    setIsLoading(true);
    setError(null);
    (isAdmin ? fetchAllDoctorsForAdmin() : fetchDoctors())
      .then(setDoctors)
      .catch((err) => setError(err.message || 'Error loading doctors'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadDoctors();
    if (isAdmin) {
      fetchDepartments().then(setDepartments).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setSaveError(null);
    setCreatedPassword(null);
    setShowModal(true);
  };

  const openEdit = (doc: DoctorProfile) => {
    setEditingId(doc.id);
    setForm({
      name: doc.name,
      email: doc.email,
      specialty: doc.specialty,
      experience: doc.experience,
      departmentId: doc.departmentId ?? '',
      consultationFee: String(doc.consultationFee ?? 0),
      weeklySchedule: doc.weeklySchedule && doc.weeklySchedule.length === 7 ? doc.weeklySchedule : defaultSchedule(),
    });
    setSaveError(null);
    setCreatedPassword(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const fee = form.consultationFee.trim() === '' ? undefined : Number(form.consultationFee);
      if (editingId) {
        await updateDoctor(editingId, {
          name: form.name,
          specialty: form.specialty,
          experience: form.experience,
          departmentId: form.departmentId || null,
          consultationFee: fee,
          weeklySchedule: form.weeklySchedule,
        });
        setShowModal(false);
        loadDoctors();
      } else {
        const created = await createDoctor({
          name: form.name,
          email: form.email,
          specialty: form.specialty,
          experience: form.experience,
          departmentId: form.departmentId || undefined,
          consultationFee: fee,
          weeklySchedule: form.weeklySchedule,
        });
        setCreatedPassword(created.temporaryPassword);
        loadDoctors();
      }
    } catch (err: unknown) {
      setSaveError((err as Error).message || 'Failed to save doctor');
    } finally {
      setSaving(false);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    try {
      await setDoctorActive(pendingToggle.id, !pendingToggle.active);
      setPendingToggle(null);
      loadDoctors();
    } catch (err: unknown) {
      setToggleError((err as Error).message || 'Failed to update doctor');
    } finally {
      setToggling(false);
    }
  };

  const specialties = useMemo(() => {
    const specs = Array.from(new Set(doctors.map((d) => d.specialty)));
    specs.sort();
    return ['All', ...specs];
  }, [doctors]);

  const groupedDoctors = useMemo(() => {
    const filtered = doctors.filter((doc) => filterSpecialty === 'All' || doc.specialty === filterSpecialty);
    const groups: Record<string, DoctorProfile[]> = {};
    filtered.forEach((doc) => {
      if (!groups[doc.specialty]) groups[doc.specialty] = [];
      groups[doc.specialty].push(doc);
    });
    return groups;
  }, [doctors, filterSpecialty]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return <div className="card p-6 border-red-500 text-red-500">Failed to load doctor schedule: {error}</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-5xl">
      <div className="card p-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary-600" />
            Doctor Schedule
          </h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            {isAdmin ? 'Manage every doctor, including deactivated ones.' : 'View available doctors grouped by specialty'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-[var(--color-text-secondary)] whitespace-nowrap">
            Filter Specialty:
          </label>
          <select
            value={filterSpecialty}
            onChange={(e) => setFilterSpecialty(e.target.value)}
            className="input text-sm py-2"
          >
            {specialties.map((spec) => (
              <option key={spec} value={spec}>
                {spec}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button onClick={openCreate} className="btn btn-primary btn-sm whitespace-nowrap gap-2">
              <Plus className="w-4 h-4" /> Add Doctor
            </button>
          )}
        </div>
      </div>

      {toggleError && <div className="alert-danger">{toggleError}</div>}

      <div className="space-y-8">
        {Object.entries(groupedDoctors).map(([specialty, docs]) => (
          <div key={specialty} className="space-y-4">
            <div className="flex items-center gap-2 border-b-2 border-primary-100 dark:border-primary-900 pb-2">
              <Stethoscope className="w-5 h-5 text-primary-500" />
              <h2 className="text-lg font-bold text-primary-900 dark:text-primary-100">{specialty}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className={`card p-4 hover:shadow-md transition-shadow border-l-4 flex flex-col justify-between h-full ${
                    doc.active ? 'border-primary-500' : 'border-[var(--color-border)] opacity-70'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{doc.name}</h3>
                      <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-semibold mt-1">
                        {doc.specialty}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="neutral">{doc.experience}</Badge>
                      {!doc.active && <Badge variant="neutral">INACTIVE</Badge>}
                    </div>
                  </div>

                  {doc.assignedDepartment && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] mb-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {doc.assignedDepartment.name}
                    </div>
                  )}

                  {isAdmin && doc.consultationFee > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] mb-1.5">
                      <IndianRupee className="w-3.5 h-3.5" />
                      {doc.consultationFee.toLocaleString('en-IN')} / consultation
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-secondary)]">
                    <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-amber-800 dark:text-amber-300 leading-tight">
                      {scheduleSummary(doc.weeklySchedule)}
                    </span>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-[var(--color-border)]">
                      <button onClick={() => openEdit(doc)} className="btn btn-secondary btn-sm gap-1">
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button onClick={() => setPendingToggle(doc)} className="btn btn-secondary btn-sm gap-1">
                        {doc.active ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {doc.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {Object.keys(groupedDoctors).length === 0 && (
          <div className="card p-12 text-center text-[var(--color-text-tertiary)]">
            No doctors found for the selected filter.
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-backdrop">
          <div className="card w-full max-w-lg p-6 animate-scale-in max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingId ? `Edit ${form.name}` : 'Add New Doctor'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>

            {createdPassword ? (
              <div className="space-y-4">
                <div className="alert-success">
                  Doctor created. One-time temporary password (shown once, not recoverable — hand it to the doctor
                  now):
                  <div className="font-mono text-sm mt-2 p-2 bg-[var(--color-surface-secondary)] rounded">
                    {createdPassword}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setShowModal(false)} className="btn btn-primary">
                    Done
                  </button>
                </div>
              </div>
            ) : (
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
                      placeholder="Dr. John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Email</label>
                    <input
                      required
                      type="email"
                      disabled={!!editingId}
                      className="input w-full disabled:opacity-60"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="john.doe@esic.gov.in"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Specialty</label>
                    <input
                      required
                      type="text"
                      className="input w-full"
                      value={form.specialty}
                      onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                      placeholder="Cardiologist"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Experience</label>
                    <input
                      required
                      type="text"
                      className="input w-full"
                      value={form.experience}
                      onChange={(e) => setForm({ ...form, experience: e.target.value })}
                      placeholder="10 Years"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Department</label>
                    <select
                      className="input w-full"
                      value={form.departmentId}
                      onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    >
                      <option value="">No department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Consultation Fee (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input w-full"
                      value={form.consultationFee}
                      onChange={(e) => setForm({ ...form, consultationFee: e.target.value })}
                      placeholder="0"
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
                    {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Doctor'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {pendingToggle && (
        <ConfirmModal
          title={pendingToggle.active ? `Deactivate ${pendingToggle.name}?` : `Reactivate ${pendingToggle.name}?`}
          message={
            pendingToggle.active
              ? 'They will no longer be able to sign in, and will disappear from the doctor list everyone else sees. Historical visits, admissions and prescriptions already recorded are unaffected.'
              : 'They will be able to sign in again and will reappear in the doctor list.'
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
