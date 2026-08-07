import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  Search,
  Eye,
  X,
  Filter,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { searchPatients, getPatientMasterRecord, updatePatientProfile } from '../api/patient.api';
import { fetchDepartments, Department } from '../api/opd.api';

/* ═══════════════════════════════════════════════════════════
   Patient Master / Central Records Module
   Aligned with NIC / ESIC Official Navy-White Theme
   ═══════════════════════════════════════════════════════════ */

export const PatientRecordsPage: React.FC = () => {
  const { token, user } = useAuth();
  const authToken = token || '';
  const userRole = (user?.role || '').toLowerCase();
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [page, setPage] = useState(1);
  const [patients, setPatients] = useState<any[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);

  // Detailed view state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'visits' | 'admissions' | 'medicines' | 'billing'>('overview');
  
  // Edit Profile form state (Receptionist/Admin only)
  const [editMode, setEditMode] = useState(false);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editAllergies, setEditAllergies] = useState('');
  const [editChronic, setEditChronic] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Fetch Departments for filtering
  useEffect(() => {
    async function loadDepts() {
      try {
        const depts = await fetchDepartments(authToken);
        setDepartments(depts);
      } catch (err) {
        console.error('Failed to load departments', err);
      }
    }
    loadDepts();
  }, [authToken]);

  // Load Patient list
  const loadPatients = async () => {
    setLoading(true);
    try {
      const res = await searchPatients(
        {
          query: searchQuery,
          department: selectedDept,
          status: selectedStatus,
          page,
          limit: 10,
        },
        authToken,
      );
      setPatients(res.items || []);
      setTotalPages(res.meta?.totalPages || 1);
    } catch (err) {
      console.error('Failed to load patient records', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, [page, selectedDept, selectedStatus, authToken]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadPatients();
  };

  // Open detailed profile view
  const handleViewProfile = async (patientId: string) => {
    setSelectedPatientId(patientId);
    setDetailLoading(true);
    setEditMode(false);
    try {
      const data = await getPatientMasterRecord(patientId, authToken);
      setDetailData(data);
      // Pre-fill edit form
      setEditPhone(data.personalInfo.mobile || '');
      setEditEmail(data.personalInfo.email || '');
      setEditAddress(data.personalInfo.address || '');
      setEditAllergies(data.personalInfo.allergies || '');
      setEditChronic(data.personalInfo.chronicDiseases || '');
    } catch (err) {
      console.error('Failed to load patient details', err);
    } finally {
      setDetailLoading(false);
    }
  };

  // Save profile edits
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) return;

    setSavingProfile(true);
    try {
      await updatePatientProfile(
        selectedPatientId,
        {
          contactPhone: editPhone,
          contactEmail: editEmail,
          address: editAddress,
          allergies: editAllergies,
          chronicDiseases: editChronic,
        },
        authToken,
      );
      // Reload profile
      const data = await getPatientMasterRecord(selectedPatientId, authToken);
      setDetailData(data);
      setEditMode(false);
      loadPatients(); // update main list
    } catch (err) {
      console.error('Failed to update patient profile', err);
    } finally {
      setSavingProfile(false);
    }
  };

  // Status badging helper
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'waiting':
        return <Badge variant="warning" dot>Waiting</Badge>;
      case 'opd':
        return <Badge variant="info" dot>OPD Consultation</Badge>;
      case 'admitted':
        return <Badge variant="danger" dot>Admitted</Badge>;
      case 'discharged':
        return <Badge variant="success">Discharged</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            Patient Central Registry (Patient Master)
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Central repository of patients, visits, admissions, pharmacy dispensing, and real-time statuses
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ── LEFT SECTION: Central Patient Table ── */}
        <div className={`space-y-5 transition-all duration-300 ${selectedPatientId ? 'lg:col-span-6 xl:col-span-7' : 'lg:col-span-12'}`}>
          {/* SEARCH & FILTERS BAR */}
          <form onSubmit={handleSearchSubmit} className="card p-4 space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by UHID, Employee ID, Mobile or Patient Name..."
                  className="input pl-9 text-xs py-2 w-full"
                />
              </div>
              
              <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="input text-xs py-2 pr-8"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="input text-xs py-2 pr-8"
                >
                  <option value="">All Statuses</option>
                  <option value="Waiting">Waiting</option>
                  <option value="OPD">OPD</option>
                  <option value="Admitted">Admitted</option>
                  <option value="Discharged">Discharged</option>
                </select>

                <button type="submit" className="btn btn-primary btn-md flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5" /> Filter
                </button>
              </div>
            </div>
          </form>

          {/* PATIENT LIST TABLE */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-b border-[var(--color-border)] uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="p-3 pl-4">Patient details</th>
                    <th className="p-3">UHID / Employee ID</th>
                    <th className="p-3">Age/Gender</th>
                    <th className="p-3">Department</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Assigned Loc</th>
                    <th className="p-3 text-right pr-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-primary)]">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-[var(--color-text-tertiary)]">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                          <span>Searching Central Registry...</span>
                        </div>
                      </td>
                    </tr>
                  ) : patients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-[var(--color-text-tertiary)]">
                        No patient records found matching filters.
                      </td>
                    </tr>
                  ) : (
                    patients.map((p) => (
                      <tr
                        key={p.id}
                        className={`hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer ${selectedPatientId === p.id ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''}`}
                        onClick={() => handleViewProfile(p.id)}
                      >
                        <td className="p-3 pl-4 font-semibold text-[13px]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-xs">
                              {p.name.charAt(0)}
                            </div>
                            <div>
                              <span className="block">{p.name}</span>
                              <span className="text-[10px] text-[var(--color-text-secondary)] font-normal">{p.mobile}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 font-mono">
                          <span className="block text-primary-700 font-bold">{p.hospitalUid}</span>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">{p.employeeId}</span>
                        </td>
                        <td className="p-3">
                          <span className="block">{p.age}</span>
                          <span className="text-[10px] text-[var(--color-text-secondary)] font-semibold">{p.gender}</span>
                        </td>
                        <td className="p-3 font-medium text-[var(--color-text-secondary)]">
                          {p.department}
                        </td>
                        <td className="p-3">
                          {getStatusBadge(p.currentStatus)}
                        </td>
                        <td className="p-3 text-[11px]">
                          {p.currentStatus === 'Admitted' ? (
                            <div>
                              <span className="font-bold text-red-600 block">{p.ward}</span>
                              <span className="text-[10px] text-[var(--color-text-secondary)]">Bed: {p.bedNumber}</span>
                            </div>
                          ) : (
                            <span className="text-[var(--color-text-tertiary)]">{p.assignedDoctor || '—'}</span>
                          )}
                        </td>
                        <td className="p-3 text-right pr-4">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewProfile(p.id);
                            }}
                            className="btn btn-secondary btn-xs inline-flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" /> View Profile
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-[var(--color-border)] flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((prev) => prev - 1)}
                    className="btn btn-secondary btn-xs"
                  >
                    Previous
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((prev) => prev + 1)}
                    className="btn btn-secondary btn-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT SECTION: Patient Detailed Master Profile ── */}
        {selectedPatientId && (
          <div className="lg:col-span-6 xl:col-span-5 card p-5 space-y-5 relative animate-slide-in">
            <button
              onClick={() => setSelectedPatientId(null)}
              className="absolute right-4 top-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            >
              <X className="w-5 h-5" />
            </button>

            {detailLoading ? (
              <div className="p-12 text-center text-[var(--color-text-tertiary)]">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span>Loading full patient history...</span>
                </div>
              </div>
            ) : detailData ? (
              <>
                {/* PATIENT BRIEF BANNER */}
                <div className="flex gap-4 border-b border-[var(--color-border)] pb-4">
                  <div className="w-[75px] h-[100px] border border-[var(--color-border)] rounded-lg overflow-hidden bg-white flex-shrink-0 flex items-center justify-center">
                    {detailData.personalInfo.photoUrl ? (
                      <img
                        src={detailData.personalInfo.photoUrl}
                        alt={detailData.personalInfo.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-2 text-[var(--color-text-tertiary)] flex flex-col items-center justify-center">
                        <span className="text-[18px] mb-1">📷</span>
                        <span className="text-[8px] font-bold tracking-wider leading-tight">NO PHOTO</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                      {detailData.personalInfo.name}
                    </h2>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      UHID: <span className="font-mono font-bold text-primary-600">{detailData.personalInfo.uhid}</span>
                    </p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="neutral">{detailData.personalInfo.age}</Badge>
                      <Badge variant="neutral">{detailData.personalInfo.gender}</Badge>
                      <Badge variant="neutral">{detailData.personalInfo.employmentType}</Badge>
                    </div>
                  </div>
                </div>

                {/* QUICK STATISTICS BAR */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-[var(--color-surface-secondary)] p-2.5 rounded-lg border border-[var(--color-border)] text-center">
                    <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider block font-semibold">Total Visits</span>
                    <span className="text-base font-extrabold text-primary-600">{detailData.stats.totalVisits}</span>
                  </div>
                  <div className="bg-[var(--color-surface-secondary)] p-2.5 rounded-lg border border-[var(--color-border)] text-center">
                    <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider block font-semibold">Admissions</span>
                    <span className="text-base font-extrabold text-red-500">{detailData.stats.totalAdmissions}</span>
                  </div>
                  <div className="bg-[var(--color-surface-secondary)] p-2.5 rounded-lg border border-[var(--color-border)] text-center">
                    <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider block font-semibold">Pending Bill</span>
                    <span className="text-base font-extrabold text-warning-600">₹{detailData.stats.pendingBills}</span>
                  </div>
                </div>

                {/* TABS SELECTOR */}
                <div className="flex border-b border-[var(--color-border)] text-xs font-semibold overflow-x-auto">
                  {[
                    { id: 'overview', label: 'Overview' },
                    { id: 'visits', label: 'Visits' },
                    { id: 'admissions', label: 'Admissions' },
                    { id: 'medicines', label: 'Medicines' },
                    { id: 'billing', label: 'Billing' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`py-2 px-3 border-b-2 whitespace-nowrap transition-colors ${
                        activeTab === tab.id
                          ? 'border-primary-500 text-primary-600'
                          : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* TAB CONTENT: OVERVIEW (Personal Info, Timeline & Stats) */}
                {activeTab === 'overview' && (
                  <div className="space-y-4 text-xs">
                    {/* Personal Info Grid */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-[var(--color-text-primary)]">Personal Details</h3>
                        {/* Only receptionist or admin can edit details */}
                        {(userRole === 'receptionist' || userRole === 'admin') && !editMode && (
                          <button
                            onClick={() => setEditMode(true)}
                            className="text-xs text-primary-600 hover:underline font-semibold"
                          >
                            Edit profile
                          </button>
                        )}
                      </div>

                      {editMode ? (
                        <form onSubmit={handleSaveProfile} className="space-y-3 bg-[var(--color-surface-secondary)] p-3 rounded-lg border border-[var(--color-border)]">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-[var(--color-text-secondary)]">Phone Number</label>
                              <input
                                type="text"
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value)}
                                className="input text-xs w-full py-1.5 mt-0.5"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-[var(--color-text-secondary)]">Email</label>
                              <input
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                className="input text-xs w-full py-1.5 mt-0.5"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[var(--color-text-secondary)]">Residential Address</label>
                            <input
                              type="text"
                              value={editAddress}
                              onChange={(e) => setEditAddress(e.target.value)}
                              className="input text-xs w-full py-1.5 mt-0.5"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-[var(--color-text-secondary)]">Allergies</label>
                              <input
                                type="text"
                                value={editAllergies}
                                onChange={(e) => setEditAllergies(e.target.value)}
                                className="input text-xs w-full py-1.5 mt-0.5"
                                placeholder="E.g. Penicillin"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-[var(--color-text-secondary)]">Chronic Diseases</label>
                              <input
                                type="text"
                                value={editChronic}
                                onChange={(e) => setEditChronic(e.target.value)}
                                className="input text-xs w-full py-1.5 mt-0.5"
                                placeholder="E.g. Diabetes"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                            <button
                              type="button"
                              onClick={() => setEditMode(false)}
                              className="btn btn-secondary btn-xs"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={savingProfile}
                              className="btn btn-primary btn-xs"
                            >
                              {savingProfile ? 'Saving...' : 'Save Profile'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 bg-[var(--color-surface-secondary)] p-3 rounded-lg border border-[var(--color-border)]">
                          <div>
                            <span className="text-[10px] text-[var(--color-text-secondary)] block">DOB / Age</span>
                            <span className="font-semibold">{detailData.personalInfo.dob} ({detailData.personalInfo.age})</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[var(--color-text-secondary)] block">Mobile phone</span>
                            <span className="font-semibold">{detailData.personalInfo.mobile}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[10px] text-[var(--color-text-secondary)] block">Residential address</span>
                            <span className="font-semibold">{detailData.personalInfo.address}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Chronic diseases warning box */}
                    {(detailData.personalInfo.allergies || detailData.personalInfo.chronicDiseases) && (
                      <div className="bg-red-50 text-red-950 p-2.5 rounded-lg border border-red-200">
                        <span className="font-bold text-[10px] block uppercase tracking-wider">Critical clinical flags</span>
                        {detailData.personalInfo.allergies && <span className="block mt-0.5">• Allergies: <strong>{detailData.personalInfo.allergies}</strong></span>}
                        {detailData.personalInfo.chronicDiseases && <span className="block">• Chronic Conditions: <strong>{detailData.personalInfo.chronicDiseases}</strong></span>}
                      </div>
                    )}

                    {/* Timeline */}
                    <div className="space-y-3">
                      <h3 className="font-bold text-[var(--color-text-primary)]">Medical Timeline</h3>
                      <div className="relative pl-6 space-y-4 border-l border-primary-100 ml-3 py-1">
                        {detailData.timeline.map((event: any, idx: number) => (
                          <div key={idx} className="relative">
                            {/* Circle bullet node */}
                            <div className="absolute -left-[31px] top-0.5 w-4.5 h-4.5 rounded-full bg-white border-2 border-primary-500 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                            </div>
                            <div>
                              <span className="font-semibold block text-[var(--color-text-primary)]">{event.title}</span>
                              <span className="text-[10px] text-[var(--color-text-secondary)] block">{event.description}</span>
                              <span className="text-[9px] text-[var(--color-text-tertiary)] font-mono">{new Date(event.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: VISIT HISTORY */}
                {activeTab === 'visits' && (
                  <div className="space-y-3">
                    <h3 className="font-bold text-xs text-[var(--color-text-primary)]">OPD Visit Log</h3>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                      {detailData.visitHistory.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-tertiary)] py-4 text-center">No OPD visits found.</p>
                      ) : (
                        detailData.visitHistory.map((visit: any) => (
                          <div key={visit.id} className="p-3 bg-[var(--color-surface-secondary)] rounded-lg border border-[var(--color-border)] space-y-2 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-primary-700">{visit.department}</span>
                              <span className="font-mono text-[9px] text-[var(--color-text-tertiary)]">
                                {new Date(visit.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Attending Doctor:</span>
                                <span className="font-medium text-[var(--color-text-primary)]">{visit.doctor}</span>
                              </div>
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Prescription:</span>
                                <span className="font-medium text-[var(--color-text-primary)]">{visit.prescription}</span>
                              </div>
                            </div>
                            <div className="bg-white p-2 rounded border border-[var(--color-border)]">
                              <span className="text-[9px] text-[var(--color-text-secondary)] block uppercase tracking-wider font-semibold">Diagnosis</span>
                              <p className="text-[11px] font-medium text-[var(--color-text-primary)] mt-0.5">{visit.diagnosis}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: ADMISSION HISTORY */}
                {activeTab === 'admissions' && (
                  <div className="space-y-3">
                    <h3 className="font-bold text-xs text-[var(--color-text-primary)]">Inpatient Admissions</h3>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                      {detailData.admissionHistory.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-tertiary)] py-4 text-center">No inpatient admissions found.</p>
                      ) : (
                        detailData.admissionHistory.map((adm: any) => (
                          <div key={adm.id} className="p-3 bg-[var(--color-surface-secondary)] rounded-lg border border-[var(--color-border)] space-y-2 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-red-700">{adm.ward}</span>
                              <Badge variant={adm.status === 'DISCHARGED' ? 'success' : 'danger'}>
                                {adm.status}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px] border-b border-[var(--color-border)] pb-2">
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Admission Date:</span>
                                <span className="font-semibold text-mono">{new Date(adm.admissionDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                              </div>
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Discharge Date:</span>
                                <span className="font-semibold text-mono">{adm.dischargeDate ? new Date(adm.dischargeDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Room / Bed:</span>
                                <span className="font-medium text-[var(--color-text-primary)]">{adm.room} / Bed {adm.bed}</span>
                              </div>
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Physician:</span>
                                <span className="font-medium text-[var(--color-text-primary)] truncate block">{adm.treatingDoctor}</span>
                              </div>
                              <div>
                                <span className="text-[var(--color-text-secondary)] block">Stay length:</span>
                                <span className="font-medium text-[var(--color-text-primary)]">{adm.lengthOfStay}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: MEDICINES */}
                {activeTab === 'medicines' && (
                  <div className="space-y-3">
                    <h3 className="font-bold text-xs text-[var(--color-text-primary)]">Prescribed & Dispensed Medicines</h3>
                    <div className="card overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-b border-[var(--color-border)] font-semibold">
                          <tr>
                            <th className="p-2.5 pl-3">Medicine Name</th>
                            <th className="p-2.5 text-center">Prescribed</th>
                            <th className="p-2.5 text-center">Dispensed</th>
                            <th className="p-2.5 text-right pr-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                          {detailData.medicines.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-4 text-center text-[var(--color-text-tertiary)]">
                                No prescribed medicines found.
                              </td>
                            </tr>
                          ) : (
                            detailData.medicines.map((med: any) => (
                              <tr key={med.id}>
                                <td className="p-2.5 pl-3 font-medium">
                                  <span className="block">{med.name}</span>
                                  <span className="text-[9px] text-[var(--color-text-secondary)]">{med.brandName}</span>
                                </td>
                                <td className="p-2.5 text-center font-mono">{med.prescribedQty}</td>
                                <td className="p-2.5 text-center font-mono">{med.dispensedQty}</td>
                                <td className="p-2.5 text-right pr-3">
                                  <Badge variant={med.status === 'DISPENSED' ? 'success' : 'neutral'}>
                                    {med.status}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: BILLING SUMMARY */}
                {activeTab === 'billing' && (
                  <div className="space-y-4 text-xs">
                    <h3 className="font-bold text-xs text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">Billing Breakdown & Transactions</h3>
                    
                    <div className="space-y-2 bg-[var(--color-surface-secondary)] p-3.5 rounded-lg border border-[var(--color-border)]">
                      <div className="flex justify-between py-1 border-b border-white/[0.08]">
                        <span className="text-[var(--color-text-secondary)]">OPD Consultation Charges (₹150/visit)</span>
                        <span className="font-semibold font-mono">₹{detailData.billingSummary.consultation}.00</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-white/[0.08]">
                        <span className="text-[var(--color-text-secondary)]">Pharmacy Dispensation cost</span>
                        <span className="font-semibold font-mono">₹{detailData.billingSummary.pharmacy}.00</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-white/[0.08]">
                        <span className="text-[var(--color-text-secondary)]">Lab Diagnostics fee (₹200/order)</span>
                        <span className="font-semibold font-mono">₹{detailData.billingSummary.lab}.00</span>
                      </div>
                      <div className="flex justify-between py-1.5 font-bold text-[13px] border-t border-[var(--color-border)] pt-2 text-[var(--color-text-primary)]">
                        <span>Total Invoice Amount</span>
                        <span className="font-mono">₹{detailData.billingSummary.total}.00</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50 text-emerald-950 p-3 rounded-lg border border-emerald-200">
                        <span className="text-[10px] text-emerald-800 uppercase tracking-wider font-semibold block">Total Paid / Cleared</span>
                        <span className="text-base font-extrabold font-mono mt-0.5">₹{detailData.billingSummary.paid}.00</span>
                      </div>
                      <div className="bg-amber-50 text-amber-950 p-3 rounded-lg border border-amber-200">
                        <span className="text-[10px] text-amber-800 uppercase tracking-wider font-semibold block">Outstanding Pending</span>
                        <span className="text-base font-extrabold font-mono mt-0.5">₹{detailData.billingSummary.pending}.00</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
