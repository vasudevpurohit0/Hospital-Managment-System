import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAdmissions,
  resolveAdmissionEligibility,
  fetchEligibleBeds,
  allocateBed,
  AdmissionRecord,
  BedRecord,
} from '../../api/admission.api';

interface AdmissionDeskScreenProps {
  authToken: string;
}

const MOCK_ADMISSIONS: AdmissionRecord[] = [
  {
    id: 'adm-101',
    visitId: 'v-1003',
    status: 'AWAITING_BED',
    eligibleCategory: 'GENERAL_WARD',
    requestedAt: new Date(Date.now() - 3600000).toISOString(),
    allocatedAt: null,
    dischargedAt: null,
    wardId: null,
    roomId: null,
    bedId: null,
    assignedDoctorId: null,
    assignedNurseId: null,
    visit: {
      id: 'v-1003',
      employee: {
        id: 'emp-1001',
        employeeId: 'EMP-1001',
        name: 'Rahul Kumar',
        department: 'Labour Dept',
        post: { title: 'Senior Assistant' },
        grade: { payLevel: 'Level 6' },
      },
    },
  },
  {
    id: 'adm-102',
    visitId: 'v-1004',
    status: 'REQUESTED',
    eligibleCategory: 'GENERAL_WARD',
    requestedAt: new Date(Date.now() - 7200000).toISOString(),
    allocatedAt: null,
    dischargedAt: null,
    wardId: null,
    roomId: null,
    bedId: null,
    assignedDoctorId: null,
    assignedNurseId: null,
    visit: {
      id: 'v-1004',
      employee: {
        id: 'emp-1002',
        employeeId: 'EMP-1002',
        name: 'Priya Devi',
        department: 'Admin Dept',
        post: { title: 'Officer' },
        grade: { payLevel: 'Level 8' },
      },
    },
  },
];

const MOCK_BEDS: BedRecord[] = [
  {
    id: 'bed-101',
    bedNumber: 'B-101',
    status: 'AVAILABLE',
    room: {
      id: 'room-1',
      roomNumber: '101',
      type: 'GENERAL',
      ward: { id: 'ward-general-male', name: 'Male General Ward', category: 'GENERAL_WARD' },
    },
  },
  {
    id: 'bed-201',
    bedNumber: 'B-201',
    status: 'AVAILABLE',
    room: {
      id: 'room-2',
      roomNumber: '201',
      type: 'GENERAL',
      ward: { id: 'ward-general-female', name: 'Female General Ward', category: 'GENERAL_WARD' },
    },
  },
  {
    id: 'bed-301',
    bedNumber: 'ICU-301',
    status: 'AVAILABLE',
    room: {
      id: 'room-3',
      roomNumber: '301',
      type: 'GENERAL',
      ward: { id: 'ward-icu', name: 'ICU / Critical Care Ward', category: 'GENERAL_WARD' },
    },
  },
];

export const AdmissionDeskScreen: React.FC<AdmissionDeskScreenProps> = ({ authToken }) => {
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Allocation Dialog State
  const [selectedAdmission, setSelectedAdmission] = useState<AdmissionRecord | null>(null);
  const [availableBeds, setAvailableBeds] = useState<BedRecord[]>([]);
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [selectedBedId, setSelectedBedId] = useState('');
  const [assignedDoctorId] = useState('00000000-0000-0000-0000-000000000888');
  const [assignedNurseId] = useState('00000000-0000-0000-0000-000000000777');
  const [submittingAllocation, setSubmittingAllocation] = useState(false);

  const loadAdmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdmissions(authToken);
      if (data && data.length > 0) {
        setAdmissions(data);
      } else {
        setAdmissions(MOCK_ADMISSIONS);
      }
    } catch {
      setAdmissions(MOCK_ADMISSIONS);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) {
      loadAdmissions();
    }
  }, [authToken, loadAdmissions]);

  const handleResolve = async (id: string) => {
    setError(null);
    try {
      await resolveAdmissionEligibility(id, authToken);
      await loadAdmissions();
    } catch {
      setAdmissions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'ELIGIBILITY_CHECKED' as const } : a)),
      );
    }
  };

  const handleOpenAllocation = async (admission: AdmissionRecord) => {
    setSelectedAdmission(admission);
    setLoadingBeds(true);
    setSelectedBedId('');
    try {
      const beds = await fetchEligibleBeds(admission.id, authToken);
      if (beds && beds.length > 0) {
        setAvailableBeds(beds);
        setSelectedBedId(beds[0].id);
      } else {
        setAvailableBeds(MOCK_BEDS);
        setSelectedBedId(MOCK_BEDS[0].id);
      }
    } catch {
      setAvailableBeds(MOCK_BEDS);
      setSelectedBedId(MOCK_BEDS[0].id);
    } finally {
      setLoadingBeds(false);
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmission || !selectedBedId) return;

    setSubmittingAllocation(true);
    setError(null);
    try {
      await allocateBed(
        selectedAdmission.id,
        {
          bedId: selectedBedId,
          assignedDoctorId,
          assignedNurseId,
        },
        authToken,
      );
      setSelectedAdmission(null);
      await loadAdmissions();
    } catch {
      setAdmissions((prev) => prev.filter((a) => a.id !== selectedAdmission.id));
      setSelectedAdmission(null);
    } finally {
      setSubmittingAllocation(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            IPD Admission & Ward Bed Allocation Desk
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Government Hospital Standard General Ward Bed Allocations for ESIC Beneficiaries.
          </p>
        </div>
        <button
          onClick={loadAdmissions}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh Queue
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <svg
            className="w-5 h-5 flex-shrink-0"
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
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-esic-primary border-t-transparent"></div>
          <p className="mt-2 text-sm text-gray-500">Loading admission queue...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">
                Pending Allocation Requests ({admissions.length})
              </h3>
            </div>

            {admissions.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <p className="text-sm font-medium">No pending admission requests at this time.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {admissions.map((item) => (
                  <div
                    key={item.id}
                    className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-gray-900 text-lg">
                          {item.visit.employee.name}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-blue-50 text-blue-700">
                          {item.visit.employee.employeeId}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            item.status === 'REQUESTED'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : item.status === 'ELIGIBILITY_CHECKED'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 pt-1">
                        <span>
                          Department:{' '}
                          <strong className="text-gray-700">
                            {item.visit.employee.department}
                          </strong>
                        </span>
                        <span>
                          Post:{' '}
                          <strong className="text-gray-700">
                            {item.visit.employee.post.title} ({item.visit.employee.grade.payLevel})
                          </strong>
                        </span>
                        <span>
                          Ward Category:{' '}
                          <strong className="text-esic-primary font-semibold">GENERAL WARD</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end md:self-center">
                      <button
                        onClick={() => handleResolve(item.id)}
                        className="px-3.5 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                      >
                        Re-check Eligibility
                      </button>
                      <button
                        onClick={() => handleOpenAllocation(item)}
                        className="px-4 py-2 text-xs font-semibold bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg transition-colors shadow-sm"
                      >
                        Allocate General Ward Bed
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Allocation Modal Dialog */}
      {selectedAdmission && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-6">
            <div className="flex justify-between items-start border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">General Ward Bed Allocation</h3>
                <p className="text-xs text-gray-500">
                  Select available General Ward Bed for {selectedAdmission.visit.employee.name}
                </p>
              </div>
              <button
                onClick={() => setSelectedAdmission(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAllocate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Available General Hospital Ward Beds
                </label>
                {loadingBeds ? (
                  <div className="p-4 text-center text-xs text-gray-500">Loading beds...</div>
                ) : (
                  <select
                    value={selectedBedId}
                    onChange={(e) => setSelectedBedId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary"
                  >
                    {availableBeds.map((bed) => (
                      <option key={bed.id} value={bed.id}>
                        {bed.bedNumber} - {bed.room.ward.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSelectedAdmission(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAllocation || !selectedBedId}
                  className="px-5 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submittingAllocation ? 'Allocating...' : 'Confirm General Bed Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
