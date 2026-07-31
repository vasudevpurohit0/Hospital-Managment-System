import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAdmissions,
  addAdmissionNote,
  dischargePatient,
  AdmissionRecord,
} from '../../api/admission.api';

interface WardStaffScreenProps {
  authToken: string;
  userRole: string; // Used to restrict Discharge approval to Doctors/SuperAdmin
}

export const WardStaffScreen: React.FC<WardStaffScreenProps> = ({ authToken, userRole }) => {
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Notes state
  const [selectedAdmissionForNote, setSelectedAdmissionForNote] = useState<AdmissionRecord | null>(
    null,
  );
  const [newNote, setNewNote] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);

  // Discharge modal state
  const [dischargingAdmission, setDischargingAdmission] = useState<AdmissionRecord | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [submittingDischarge, setSubmittingDischarge] = useState(false);

  const loadAdmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdmissions(authToken);
      setAdmissions(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ward admissions');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) {
      loadAdmissions();
    }
  }, [authToken, loadAdmissions]);

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmissionForNote || !newNote.trim()) return;

    setSubmittingNote(true);
    setError(null);
    try {
      await addAdmissionNote(selectedAdmissionForNote.id, { note: newNote.trim() }, authToken);
      setNewNote('');
      setSelectedAdmissionForNote(null);
      await loadAdmissions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleDischargeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dischargingAdmission || !summaryText.trim()) return;

    setSubmittingDischarge(true);
    setError(null);
    try {
      await dischargePatient(
        dischargingAdmission.id,
        { summaryText: summaryText.trim() },
        authToken,
      );
      setSummaryText('');
      setDischargingAdmission(null);
      await loadAdmissions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmittingDischarge(false);
    }
  };

  const activeAdmissions = admissions.filter((a) => a.status === 'UNDER_TREATMENT');
  const isDoctorOrAdmin =
    userRole === 'Doctor' || userRole === 'SuperAdmin' || userRole === 'Administrator';

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Ward & Clinical Round Console
          </h2>
          <p className="text-sm text-gray-500">
            Log daily observation notes and authorize doctor-approved discharge for active ward
            patients.
          </p>
        </div>
        <button
          onClick={loadAdmissions}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 bg-white shadow-sm transition-all"
        >
          🔄 Refresh Ward
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start">
          <svg
            className="w-5 h-5 mr-2 text-red-500 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <svg
            className="animate-spin h-8 w-8 text-esic-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-800">
            Patients Under Treatment ({activeAdmissions.length})
          </h3>

          {activeAdmissions.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-500 shadow-sm">
              <span className="text-4xl block mb-2">🧑‍⚕️</span>
              No patients are currently admitted in the ward.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {activeAdmissions.map((adm) => (
                <div
                  key={adm.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row justify-between gap-6 hover:border-gray-200 transition-all"
                >
                  {/* Left Column: Demographics & Allocation details */}
                  <div className="flex-grow space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-xl text-gray-900">
                          {adm.visit.employee.name}
                        </h4>
                        <span className="text-xs text-gray-500 font-mono">
                          ID: {adm.visit.employee.employeeId} | Dept:{' '}
                          {adm.visit.employee.department}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200">
                          Admitted (Bed: {adm.bed?.bedNumber || 'M-1'})
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
                      <div>
                        <span className="text-gray-400 block">Attending Doctor</span>
                        <span className="font-medium text-gray-800">
                          {adm.assignedDoctor?.identifier || 'Dr. Verma'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Care Nurse</span>
                        <span className="font-medium text-gray-800">
                          {adm.assignedNurse?.identifier || 'Nurse Emily'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Category</span>
                        <span className="font-medium text-purple-700 font-semibold">
                          {adm.eligibleCategory}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Admission Date</span>
                        <span className="font-medium text-gray-800">
                          {adm.allocatedAt ? new Date(adm.allocatedAt).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                    </div>

                    {/* Notes history */}
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                        Clinical Round Notes ({adm.notes?.length || 0})
                      </span>
                      {!adm.notes || adm.notes.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No notes logged yet today.</p>
                      ) : (
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                          {adm.notes.map((note) => (
                            <div
                              key={note.id}
                              className="bg-gray-50 border border-gray-200/50 p-2.5 rounded-lg text-xs"
                            >
                              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                <span>By: {note.author.identifier}</span>
                                <span>{new Date(note.createdAt).toLocaleString()}</span>
                              </div>
                              <p className="text-gray-700 font-medium">{note.note}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-row md:flex-col justify-end gap-3 min-w-[150px]">
                    <button
                      onClick={() => setSelectedAdmissionForNote(adm)}
                      className="flex-grow px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold shadow-sm transition-all text-center"
                    >
                      📝 Log Observation Note
                    </button>
                    {isDoctorOrAdmin ? (
                      <button
                        onClick={() => setDischargingAdmission(adm)}
                        className="flex-grow px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all text-center"
                      >
                        🛌 Discharge Patient
                      </button>
                    ) : (
                      <button
                        disabled
                        className="flex-grow px-4 py-2 bg-gray-100 border border-gray-200 text-gray-400 rounded-lg text-xs font-semibold transition-all text-center cursor-not-allowed"
                        title="Only users with Doctor role can approve discharge"
                      >
                        🔒 Discharge (Doctor Only)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Note Modal */}
      {selectedAdmissionForNote && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-100 overflow-hidden transform scale-100 transition-transform">
            <div className="bg-esic-primary text-white px-6 py-4">
              <h3 className="font-bold text-lg">Log clinical note</h3>
              <p className="text-xs text-blue-100">
                Patient: {selectedAdmissionForNote.visit.employee.name}
              </p>
            </div>

            <form onSubmit={handleAddNoteSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Daily Observation & Treatment Note
                </label>
                <textarea
                  required
                  rows={4}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Record patient vital checks, administered medicines, or ward comments..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setSelectedAdmissionForNote(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNote || !newNote.trim()}
                  className="px-5 py-2 bg-esic-secondary hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {submittingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discharge Approval Modal */}
      {dischargingAdmission && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-100 overflow-hidden transform scale-100 transition-transform">
            <div className="bg-red-700 text-white px-6 py-4">
              <h3 className="font-bold text-lg">Doctor Discharge Handoff</h3>
              <p className="text-xs text-red-100">
                Patient: {dischargingAdmission.visit.employee.name}
              </p>
            </div>

            <form onSubmit={handleDischargeSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                  Discharge Summary Notes
                </label>
                <textarea
                  required
                  rows={4}
                  value={summaryText}
                  onChange={(e) => setSummaryText(e.target.value)}
                  placeholder="Summarize course of treatment in hospital, final diagnosis condition, and follow-up advice..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-600 focus:border-transparent transition-all"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setDischargingAdmission(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDischarge || !summaryText.trim()}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {submittingDischarge ? 'Discharging...' : 'Approve Discharge & Free Bed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
