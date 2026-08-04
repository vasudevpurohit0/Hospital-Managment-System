import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAdmissions,
  addAdmissionNote,
  dischargePatient,
  fetchAllWards,
  createWardAndBed,
  deleteWard,
  deleteBed,
  AdmissionRecord,
  WardManagementRecord,
} from '../../api/admission.api';

interface WardStaffScreenProps {
  authToken: string;
  userRole: string; // Used to restrict Discharge approval to Doctors/SuperAdmin
}

export const WardStaffScreen: React.FC<WardStaffScreenProps> = ({ authToken, userRole }) => {
  const [activeTab, setActiveTab] = useState<'rounds' | 'management'>('rounds');

  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [wards, setWards] = useState<WardManagementRecord[]>([]);
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

  // Ward creation modal state
  const [showAddWardModal, setShowAddWardModal] = useState(false);
  const [selectedWardId, setSelectedWardId] = useState<string>('');
  const [wardName, setWardName] = useState('');
  const [wardCategory, setWardCategory] = useState('C');
  const [roomNumber, setRoomNumber] = useState('Room 101');
  const [bedNumber, setBedNumber] = useState('');
  const [bedCount, setBedCount] = useState('3');
  const [submittingWard, setSubmittingWard] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [admData, wardData] = await Promise.all([
        fetchAdmissions(authToken),
        fetchAllWards(authToken),
      ]);
      setAdmissions(admData);
      setWards(wardData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ward console data');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) {
      loadData();
    }
  }, [authToken, loadData]);

  const handleCreateWardBedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWardId && !wardName.trim()) return;

    setSubmittingWard(true);
    setError(null);
    try {
      await createWardAndBed(
        {
          wardId: selectedWardId || undefined,
          wardName: !selectedWardId ? wardName.trim() : undefined,
          wardCategory: !selectedWardId ? wardCategory : undefined,
          roomNumber: roomNumber.trim(),
          bedNumber: bedNumber.trim() || undefined,
          count: parseInt(bedCount, 10) || 1,
        },
        authToken,
      );
      setShowAddWardModal(false);
      setSelectedWardId('');
      setWardName('');
      setRoomNumber('');
      setBedNumber('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create ward/beds');
    } finally {
      setSubmittingWard(false);
    }
  };

  const handleDeleteWard = async (wardId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete Ward "${name}" and all its beds?`)) return;
    setError(null);
    try {
      await deleteWard(wardId, authToken);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete ward');
    }
  };

  const handleDeleteBed = async (bedId: string, bedNum: string) => {
    if (!window.confirm(`Delete Bed ${bedNum}?`)) return;
    setError(null);
    try {
      await deleteBed(bedId, authToken);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete bed');
    }
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmissionForNote || !newNote.trim()) return;

    setSubmittingNote(true);
    setError(null);
    try {
      await addAdmissionNote(selectedAdmissionForNote.id, { note: newNote.trim() }, authToken);
      setNewNote('');
      setSelectedAdmissionForNote(null);
      await loadData();
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
      await loadData();
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

  // Stats calculation for Ward Management
  const totalWards = wards.length;
  const totalBeds = wards.reduce(
    (acc, w) => acc + w.rooms.reduce((rAcc, r) => rAcc + r.beds.length, 0),
    0,
  );
  const availableBedsCount = wards.reduce(
    (acc, w) =>
      acc +
      w.rooms.reduce(
        (rAcc, r) => rAcc + r.beds.filter((b) => b.status === 'AVAILABLE').length,
        0,
      ),
    0,
  );
  const occupiedBedsCount = totalBeds - availableBedsCount;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Console Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 pb-4 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            Ward & Inpatient Care Console
          </h2>
          <p className="text-sm text-gray-500">
            Log daily observation notes, manage hospital ward beds, and authorize patient discharge.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'management' && (
            <button
              onClick={() => setShowAddWardModal(true)}
              className="px-4 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-2"
            >
              <span>+ Add New Ward / Bed</span>
            </button>
          )}
          <button
            onClick={loadData}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 bg-white shadow-sm transition-all"
          >
            🔄 Refresh Console
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 gap-4">
        <button
          onClick={() => setActiveTab('rounds')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'rounds'
              ? 'border-esic-primary text-esic-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span>🧑‍⚕️</span> Clinical Rounds & Active Patients ({activeAdmissions.length})
        </button>
        <button
          onClick={() => setActiveTab('management')}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'management'
              ? 'border-esic-primary text-esic-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span>🏥</span> Ward & Bed Management Master ({totalWards} Wards, {totalBeds} Beds)
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
      ) : activeTab === 'rounds' ? (
        /* TAB 1: CLINICAL ROUNDS & PATIENTS */
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
                          Admitted (Bed: {adm.bed?.bedNumber || 'Unassigned'})
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
                      <div>
                        <span className="text-gray-400 block">Attending Doctor</span>
                        <span className="font-medium text-gray-800">
                          {adm.assignedDoctor?.identifier || 'Not assigned'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Care Nurse</span>
                        <span className="font-medium text-gray-800">
                          {adm.assignedNurse?.identifier || 'Not assigned'}
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
      ) : (
        /* TAB 2: WARD & BED MANAGEMENT CONSOLE */
        <div className="space-y-6">
          {/* Summary KPI Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase">Hospital Wards</span>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalWards}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase">Total Ward Beds</span>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalBeds}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase">Available Beds</span>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{availableBedsCount}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-400 uppercase">Occupied Beds</span>
              <p className="text-2xl font-bold text-amber-600 mt-1">{occupiedBedsCount}</p>
            </div>
          </div>

          {/* Wards Catalog Grid */}
          <div className="space-y-6">
            {wards.map((w) => {
              const wardTotalBeds = w.rooms.reduce((acc, r) => acc + r.beds.length, 0);
              const wardAvailable = w.rooms.reduce(
                (acc, r) => acc + r.beds.filter((b) => b.status === 'AVAILABLE').length,
                0,
              );

              return (
                <div
                  key={w.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
                >
                  <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">{w.name}</h3>
                        <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                          Category {w.category}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {w.rooms.length} Rooms • {wardTotalBeds} Total Beds
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold">
                        {wardAvailable} Available / {wardTotalBeds} Beds
                      </span>
                      <button
                        onClick={() => {
                          setSelectedWardId(w.id);
                          setShowAddWardModal(true);
                        }}
                        className="px-3 py-1.5 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        + Add Beds
                      </button>
                      <button
                        onClick={() => handleDeleteWard(w.id, w.name)}
                        className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-xs font-semibold transition-all"
                        title="Delete Ward"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Rooms & Beds Layout */}
                  <div className="p-5 space-y-4">
                    {w.rooms.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No rooms registered in this ward.</p>
                    ) : (
                      w.rooms.map((r) => (
                        <div key={r.id} className="space-y-2">
                          <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                            🚪 Room {r.roomNumber} ({r.type} Room)
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                            {r.beds.map((b) => (
                              <div
                                key={b.id}
                                className={`p-3 rounded-lg border text-xs flex flex-col justify-between relative group ${
                                  b.status === 'AVAILABLE'
                                    ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900'
                                    : 'bg-red-50/70 border-red-300 text-red-900'
                                }`}
                              >
                                <div className="font-bold flex justify-between items-center">
                                  <span>🛏️ {b.bedNumber}</span>
                                  {b.status === 'AVAILABLE' ? (
                                    <button
                                      onClick={() => handleDeleteBed(b.id, b.bedNumber)}
                                      className="text-red-500 hover:text-red-700 font-bold px-1 text-xs opacity-80 hover:opacity-100"
                                      title="Delete Available Bed"
                                    >
                                      ✖
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-red-700 font-bold">🔴 Occupied</span>
                                  )}
                                </div>
                                {b.currentAdmission?.visit?.employee?.name ? (
                                  <div className="mt-2 text-[10px] truncate font-medium">
                                    {b.currentAdmission.visit.employee.name}
                                  </div>
                                ) : (
                                  <span className="mt-2 text-[10px] text-emerald-700 font-medium">🟢 Free</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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

      {/* Add New Ward & Beds Modal */}
      {showAddWardModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">
                {selectedWardId ? 'Add Multiple Beds to Existing Ward' : 'Register New Hospital Ward & Beds'}
              </h3>
              <button
                onClick={() => {
                  setShowAddWardModal(false);
                  setSelectedWardId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateWardBedSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Target Ward *</label>
                <select
                  value={selectedWardId}
                  onChange={(e) => setSelectedWardId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium"
                >
                  <option value="">+ Create a Brand New Ward</option>
                  {wards.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} (Category {w.category})
                    </option>
                  ))}
                </select>
              </div>

              {!selectedWardId && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">New Ward Name *</label>
                    <input
                      type="text"
                      required
                      value={wardName}
                      onChange={(e) => setWardName(e.target.value)}
                      placeholder="e.g. ICU / Special Care Ward"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Eligibility Category *</label>
                    <select
                      value={wardCategory}
                      onChange={(e) => setWardCategory(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="A">Category A (Private Single Room)</option>
                      <option value="B">Category B (Semi-Private Shared)</option>
                      <option value="C">Category C (General Ward C)</option>
                      <option value="D">Category D (General Ward D)</option>
                      <option value="CONTRACTUAL">Contractual Policy Ward</option>
                    </select>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Room Number *</label>
                  <input
                    type="text"
                    required
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    placeholder="e.g. Room 101"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Number of Beds *</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={bedCount}
                    onChange={(e) => setBedCount(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Custom Bed Numbers (Optional)
                </label>
                <input
                  type="text"
                  value={bedNumber}
                  onChange={(e) => setBedNumber(e.target.value)}
                  placeholder="e.g. B1, B2, B3 (or leave blank to auto-number)"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-[11px] text-gray-400">
                  Separate multiple bed numbers with commas, or use auto-numbering above.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddWardModal(false);
                    setSelectedWardId('');
                  }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWard}
                  className="px-4 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  {submittingWard ? 'Saving Beds...' : 'Save Ward & Create Beds'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
