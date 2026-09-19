import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAdmissions,
  addAdmissionNote,
  dischargePatient,
  fetchAllWards,
  createWardAndBed,
  deleteWard,
  deleteBed,
  fetchEligibleBeds,
  fetchAdmissionFinancialSummary,
  fetchLocationHistory,
  transferBed,
  AdmissionRecord,
  WardManagementRecord,
  BedRecord,
  AdmissionFinancialSummary,
  LocationHistoryEntry,
} from '../../api/admission.api';
import { fetchServices, ServiceListItem } from '../../api/catalog.api';
import { openTherapyCourse, scheduleTherapySession, fetchTherapySessions, fetchTherapyCourses, TherapySessionRecord, TherapyCourseRecord } from '../../api/therapy.api';
import {
  fetchLabTests,
  orderLabTests,
  fetchLabQueue,
  LabTestSummary,
  LabOrderRecord,
} from '../../api/lab.api';
import { createPrescription, signPrescription } from '../../api/prescription.api';
import { fetchMedicines, MedicineRecord } from '../../api/inventory.api';
import { fetchVisitById } from '../../api/patient-lookup.api';
import { fetchPatientLedger } from '../../api/ledger.api';
import { useNavigate } from 'react-router-dom';
import { fetchBranding } from '../../api/security.api';
import { TestTube, Pill, Plus, Trash2, IndianRupee, ArrowRight } from 'lucide-react';
import { formatDateDefault, formatDateIN, formatDateTimeDefault, formatDateTimeIN } from '../../utils/date';

interface WardStaffScreenProps {
  authToken: string;
  userRole: string; // Used to restrict Discharge approval to Doctors/SuperAdmin
  onNavigate?: (page: any) => void;
}

export const WardStaffScreen: React.FC<WardStaffScreenProps> = ({ authToken, userRole, onNavigate }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'rounds' | 'management'>('rounds');

  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [wards, setWards] = useState<WardManagementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState('ESIC Model Hospital & ODC');

  useEffect(() => {
    fetchBranding()
      .then((b) => b.hospitalName && setHospitalName(b.hospitalName))
      .catch(() => {
        // Non-fatal: the printed discharge card falls back to the default hospital name.
      });
  }, []);

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
  const [recentlyDischarged, setRecentlyDischarged] = useState<AdmissionRecord | null>(null);
  const [printSummary, setPrintSummary] = useState('');
  const [dischargeLedgerLoading, setDischargeLedgerLoading] = useState(false);
  const [dischargeOutstandingBalance, setDischargeOutstandingBalance] = useState<number | null>(null);
  const [dischargeLedgerError, setDischargeLedgerError] = useState<string | null>(null);

  // Ward creation modal state
  const [showAddWardModal, setShowAddWardModal] = useState(false);
  const [selectedWardId, setSelectedWardId] = useState<string>('');
  const [wardName, setWardName] = useState('');
  const [wardCategory, setWardCategory] = useState('C');
  const [roomNumber, setRoomNumber] = useState('Room 101');
  const [bedNumber, setBedNumber] = useState('');
  const [bedCount, setBedCount] = useState('3');
  const [submittingWard, setSubmittingWard] = useState(false);

  // Financial summary / bed transfer / location history modal (Feature 8/9)
  const [financeAdmission, setFinanceAdmission] = useState<AdmissionRecord | null>(null);
  const [financeTab, setFinanceTab] = useState<'summary' | 'transfer' | 'history'>('summary');
  const [financeSummary, setFinanceSummary] = useState<AdmissionFinancialSummary | null>(null);
  const [locationHistory, setLocationHistory] = useState<LocationHistoryEntry[]>([]);
  const [eligibleBedsForTransfer, setEligibleBedsForTransfer] = useState<BedRecord[]>([]);
  const [transferBedId, setTransferBedId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [financeLoading, setFinanceLoading] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const canTransfer = ['Nurse', 'AdmissionDesk', 'SuperAdmin', 'Administrator'].includes(userRole);

  // Recommend Therapy modal (IPD entry point 3)
  const [therapyAdmission, setTherapyAdmission] = useState<AdmissionRecord | null>(null);
  const [therapyServices, setTherapyServices] = useState<ServiceListItem[]>([]);
  const [selectedTherapyServiceId, setSelectedTherapyServiceId] = useState('');
  const [therapyPlannedSessions, setTherapyPlannedSessions] = useState(1);
  const [existingTherapySessions, setExistingTherapySessions] = useState<TherapySessionRecord[]>([]);
  const [existingTherapyCourses, setExistingTherapyCourses] = useState<TherapyCourseRecord[]>([]);
  const [therapyLoading, setTherapyLoading] = useState(false);
  const [therapyBooking, setTherapyBooking] = useState(false);
  const [therapyMessage, setTherapyMessage] = useState<string | null>(null);

  // Order Laboratory Test modal state
  const [labAdmission, setLabAdmission] = useState<AdmissionRecord | null>(null);
  const [availableLabTests, setAvailableLabTests] = useState<LabTestSummary[]>([]);
  const [selectedLabTestIds, setSelectedLabTestIds] = useState<string[]>([]);
  const [labTestPicker, setLabTestPicker] = useState('');
  const [labPriority, setLabPriority] = useState<'ROUTINE' | 'URGENT' | 'STAT'>('ROUTINE');
  const [labClinicalNotes, setLabClinicalNotes] = useState('');
  const [existingLabOrders, setExistingLabOrders] = useState<LabOrderRecord[]>([]);
  const [labLoading, setLabLoading] = useState(false);
  const [labSubmitting, setLabSubmitting] = useState(false);
  const [labMessage, setLabMessage] = useState<string | null>(null);
  const [labError, setLabError] = useState<string | null>(null);

  // Prescribe Medicine modal state
  const [rxAdmission, setRxAdmission] = useState<AdmissionRecord | null>(null);
  const [availableMedicines, setAvailableMedicines] = useState<MedicineRecord[]>([]);
  const [rxDiagnosis, setRxDiagnosis] = useState('');
  const [rxSymptoms, setRxSymptoms] = useState('');
  const [rxItems, setRxItems] = useState<Array<{ medicineName: string; dose: string; frequency: string; duration: string }>>([
    { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days' },
  ]);
  const [existingPrescriptions, setExistingPrescriptions] = useState<any[]>([]);
  const [rxLoading, setRxLoading] = useState(false);
  const [rxSubmitting, setRxSubmitting] = useState(false);
  const [rxMessage, setRxMessage] = useState<string | null>(null);
  const [rxError, setRxError] = useState<string | null>(null);

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

  const handleInitiateDischarge = async (adm: AdmissionRecord) => {
    setDischargingAdmission(adm);
    setSummaryText('');
    setDischargeOutstandingBalance(null);
    setDischargeLedgerError(null);
    setDischargeLedgerLoading(true);

    try {
      const ledger = await fetchPatientLedger(adm.visit.employee.employeeId, authToken);
      const outstanding = parseFloat(ledger?.summary?.outstandingAmount || '0');
      setDischargeOutstandingBalance(isNaN(outstanding) ? 0 : outstanding);
    } catch (err: unknown) {
      console.error('Failed to check patient ledger for discharge', err);
      setDischargeLedgerError(err instanceof Error ? err.message : 'Could not check ledger balance');
      setDischargeOutstandingBalance(0);
    } finally {
      setDischargeLedgerLoading(false);
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
      
      // Save for printing
      setRecentlyDischarged(dischargingAdmission);
      setPrintSummary(summaryText.trim());

      setSummaryText('');
      setDischargingAdmission(null);
      setDischargeOutstandingBalance(null);
      setDischargeLedgerError(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmittingDischarge(false);
    }
  };

  const handleOpenFinance = async (adm: AdmissionRecord) => {
    setFinanceAdmission(adm);
    setFinanceTab('summary');
    setFinanceLoading(true);
    setError(null);
    try {
      const [summary, history] = await Promise.all([
        fetchAdmissionFinancialSummary(adm.id, authToken),
        fetchLocationHistory(adm.id, authToken),
      ]);
      setFinanceSummary(summary);
      setLocationHistory(history);
      if (canTransfer) {
        const beds = await fetchEligibleBeds(adm.id, authToken);
        setEligibleBedsForTransfer(beds.filter((b) => b.id !== adm.bedId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admission financials');
    } finally {
      setFinanceLoading(false);
    }
  };

  const handleTransferSubmit = async () => {
    if (!financeAdmission || !transferBedId || transferReason.trim().length < 3) return;
    setTransferSubmitting(true);
    setError(null);
    try {
      await transferBed(financeAdmission.id, { toBedId: transferBedId, reason: transferReason.trim() }, authToken);
      setTransferBedId('');
      setTransferReason('');
      await loadData();
      await handleOpenFinance(financeAdmission);
      setFinanceTab('history');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer patient');
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleOpenTherapy = async (adm: AdmissionRecord) => {
    setTherapyAdmission(adm);
    setTherapyMessage(null);
    setSelectedTherapyServiceId('');
    setTherapyLoading(true);
    setError(null);
    try {
      if (therapyServices.length === 0) {
        const res = await fetchServices({ serviceType: 'THERAPY', active: true, limit: 100 }, authToken);
        setTherapyServices(res.items);
      }
      const [sessions, courses] = await Promise.all([
        fetchTherapySessions(authToken, { visitId: adm.visitId }),
        fetchTherapyCourses(authToken, { visitId: adm.visitId }),
      ]);
      setExistingTherapySessions(sessions);
      setExistingTherapyCourses(courses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load therapy catalogue');
    } finally {
      setTherapyLoading(false);
    }
  };

  const selectedTherapyService = therapyServices.find((s) => s.id === selectedTherapyServiceId);

  const handleRecommendIpdTherapy = async () => {
    if (!therapyAdmission || !selectedTherapyServiceId) return;
    setTherapyBooking(true);
    setError(null);
    try {
      if (selectedTherapyService?.unit === 'COURSE') {
        await openTherapyCourse(
          {
            visitId: therapyAdmission.visitId,
            admissionId: therapyAdmission.id,
            serviceId: selectedTherapyServiceId,
            plannedSessions: therapyPlannedSessions,
          },
          authToken,
        );
        setTherapyMessage(`Course opened: ${selectedTherapyService.name}.`);
      } else {
        await scheduleTherapySession(
          { visitId: therapyAdmission.visitId, admissionId: therapyAdmission.id, serviceId: selectedTherapyServiceId },
          authToken,
        );
        setTherapyMessage(`Session scheduled: ${selectedTherapyService?.name}.`);
      }
      setSelectedTherapyServiceId('');
      await handleOpenTherapy(therapyAdmission);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recommend therapy');
    } finally {
      setTherapyBooking(false);
    }
  };

  const handleOpenLabOrder = async (adm: AdmissionRecord) => {
    setLabAdmission(adm);
    setLabMessage(null);
    setLabError(null);
    setSelectedLabTestIds([]);
    setLabTestPicker('');
    setLabPriority('ROUTINE');
    setLabClinicalNotes('');
    setLabLoading(true);
    try {
      if (availableLabTests.length === 0) {
        const tests = await fetchLabTests(authToken);
        setAvailableLabTests(tests.filter((t) => t.active));
      }
      const orders = await fetchLabQueue(authToken, { visitId: adm.visitId });
      setExistingLabOrders(orders);
    } catch (err) {
      setLabError(err instanceof Error ? err.message : 'Failed to load laboratory catalog');
    } finally {
      setLabLoading(false);
    }
  };

  const handleAddLabTest = () => {
    if (!labTestPicker) return;
    if (!selectedLabTestIds.includes(labTestPicker)) {
      setSelectedLabTestIds([...selectedLabTestIds, labTestPicker]);
    }
    setLabTestPicker('');
  };

  const handleRemoveLabTest = (testId: string) => {
    setSelectedLabTestIds(selectedLabTestIds.filter((id) => id !== testId));
  };

  const labTestName = (id: string) => availableLabTests.find((t) => t.id === id)?.name ?? id;

  const handleSubmitLabOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!labAdmission || selectedLabTestIds.length === 0) return;
    setLabSubmitting(true);
    setLabError(null);
    setLabMessage(null);
    try {
      const order = await orderLabTests(
        {
          visitId: labAdmission.visitId,
          admissionId: labAdmission.id,
          labTestIds: selectedLabTestIds,
          priority: labPriority,
          clinicalNotes: labClinicalNotes.trim() || undefined,
        },
        authToken,
      );
      setLabMessage(
        `Laboratory order ${order.labNumber || order.id.slice(0, 8)} placed successfully with ${selectedLabTestIds.length} test(s).`,
      );
      setSelectedLabTestIds([]);
      setLabTestPicker('');
      setLabClinicalNotes('');
      const orders = await fetchLabQueue(authToken, { visitId: labAdmission.visitId });
      setExistingLabOrders(orders);
    } catch (err) {
      setLabError(err instanceof Error ? err.message : 'Failed to place laboratory order');
    } finally {
      setLabSubmitting(false);
    }
  };

  const handleOpenPrescription = async (adm: AdmissionRecord) => {
    setRxAdmission(adm);
    setRxMessage(null);
    setRxError(null);
    setRxDiagnosis('Inpatient Treatment & Observation');
    setRxSymptoms('');
    setRxItems([
      { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days' },
    ]);
    setRxLoading(true);
    try {
      if (availableMedicines.length === 0) {
        const meds = await fetchMedicines(authToken);
        setAvailableMedicines(meds);
      }
      const visitDetail = await fetchVisitById(adm.visitId, authToken);
      setExistingPrescriptions(visitDetail.prescriptions || []);
      if (visitDetail.diagnoses && visitDetail.diagnoses.length > 0) {
        const latestDx = visitDetail.diagnoses[visitDetail.diagnoses.length - 1];
        if (latestDx.diagnosisText) {
          setRxDiagnosis(latestDx.diagnosisText);
        }
        if (latestDx.symptoms) {
          setRxSymptoms(latestDx.symptoms);
        }
      }
    } catch (err) {
      setRxError(err instanceof Error ? err.message : 'Failed to load medicines or existing records');
    } finally {
      setRxLoading(false);
    }
  };

  const handleAddRxItem = () => {
    setRxItems([
      ...rxItems,
      { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days' },
    ]);
  };

  const handleRemoveRxItem = (index: number) => {
    if (rxItems.length <= 1) return;
    setRxItems(rxItems.filter((_, i) => i !== index));
  };

  const handleRxItemChange = (
    index: number,
    field: 'medicineName' | 'dose' | 'frequency' | 'duration',
    value: string,
  ) => {
    const updated = [...rxItems];
    updated[index] = { ...updated[index], [field]: value };
    setRxItems(updated);
  };

  const handleSubmitPrescription = async (signAndSend: boolean) => {
    if (!rxAdmission) return;
    if (!rxDiagnosis.trim()) {
      setRxError('Diagnosis / Indication is required to create a prescription.');
      return;
    }
    const validItems = rxItems.filter((i) => i.medicineName && i.medicineName.trim() !== '');
    if (validItems.length === 0) {
      setRxError('Please select at least one medicine to prescribe.');
      return;
    }

    setRxSubmitting(true);
    setRxError(null);
    setRxMessage(null);

    try {
      const res = await createPrescription(
        {
          visitId: rxAdmission.visitId,
          diagnosisText: rxDiagnosis.trim(),
          symptoms: rxSymptoms.trim() || undefined,
          items: validItems.map((i) => ({
            medicineName: i.medicineName.trim(),
            dose: i.dose.trim() || '1 Tablet',
            frequency: i.frequency.trim() || '1-0-1',
            duration: i.duration.trim() || '5 Days',
          })),
        },
        authToken,
      );

      if (signAndSend) {
        await signPrescription(res.prescription.id, authToken);
        setRxMessage(
          `Prescription ${res.prescription.id.slice(0, 8)} digitally signed and sent to Pharmacy Dispensing queue!`,
        );
      } else {
        setRxMessage(`Prescription draft ${res.prescription.id.slice(0, 8)} saved successfully.`);
      }

      setRxItems([{ medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days' }]);
      const visitDetail = await fetchVisitById(rxAdmission.visitId, authToken);
      setExistingPrescriptions(visitDetail.prescriptions || []);
    } catch (err) {
      setRxError(err instanceof Error ? err.message : 'Failed to save prescription');
    } finally {
      setRxSubmitting(false);
    }
  };

  const activeAdmissionsUnfiltered = admissions.filter((a) => a.status === 'UNDER_TREATMENT');
  const patientSearchQueryLower = patientSearchQuery.trim().toLowerCase();
  const activeAdmissions = patientSearchQueryLower
    ? activeAdmissionsUnfiltered.filter(
        (a) =>
          a.visit.employee.name.toLowerCase().includes(patientSearchQueryLower) ||
          a.visit.employee.employeeId.toLowerCase().includes(patientSearchQueryLower),
      )
    : activeAdmissionsUnfiltered;
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
    <>
    <div className="max-w-6xl mx-auto p-6 space-y-6 print:hidden">
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
          <span>🧑‍⚕️</span> Clinical Rounds & Active Patients ({activeAdmissionsUnfiltered.length})
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
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-800">
              Patients Under Treatment ({activeAdmissionsUnfiltered.length})
            </h3>
            {activeAdmissionsUnfiltered.length > 0 && (
              <input
                type="text"
                value={patientSearchQuery}
                onChange={(e) => setPatientSearchQuery(e.target.value)}
                placeholder="Find a patient by name or Employee ID..."
                className="w-full md:w-72 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-esic-primary/30"
              />
            )}
          </div>

          {activeAdmissionsUnfiltered.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-500 shadow-sm">
              <span className="text-4xl block mb-2">🧑‍⚕️</span>
              No patients are currently admitted in the ward.
            </div>
          ) : activeAdmissions.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-500 shadow-sm">
              <span className="text-4xl block mb-2">🔍</span>
              No patient matches "{patientSearchQuery}".
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
                          {adm.assignedDoctor?.employee?.name || adm.assignedDoctor?.identifier || 'Not assigned'}
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
                          {adm.allocatedAt ? formatDateDefault(adm.allocatedAt) : 'N/A'}
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
                                <span>{formatDateTimeDefault(note.createdAt)}</span>
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
                        onClick={() => handleOpenLabOrder(adm)}
                        className="flex-grow px-4 py-2 border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg text-xs font-semibold shadow-sm transition-all text-center flex items-center justify-center gap-1.5"
                      >
                        <TestTube className="w-3.5 h-3.5 text-sky-600" />
                        Order Laboratory Test
                      </button>
                    ) : (
                      <button
                        disabled
                        className="flex-grow px-4 py-2 bg-gray-100 border border-gray-200 text-gray-400 rounded-lg text-xs font-semibold transition-all text-center cursor-not-allowed flex items-center justify-center gap-1.5"
                        title="Only users with Doctor or Admin role can order laboratory tests"
                      >
                        <TestTube className="w-3.5 h-3.5 text-gray-400" />
                        Order Laboratory Test (Doctor Only)
                      </button>
                    )}
                    {isDoctorOrAdmin ? (
                      <button
                        onClick={() => handleOpenPrescription(adm)}
                        className="flex-grow px-4 py-2 border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-lg text-xs font-semibold shadow-sm transition-all text-center flex items-center justify-center gap-1.5"
                      >
                        <Pill className="w-3.5 h-3.5 text-indigo-600" />
                        Prescribe Medicine
                      </button>
                    ) : (
                      <button
                        disabled
                        className="flex-grow px-4 py-2 bg-gray-100 border border-gray-200 text-gray-400 rounded-lg text-xs font-semibold transition-all text-center cursor-not-allowed flex items-center justify-center gap-1.5"
                        title="Only users with Doctor or Admin role can prescribe medicines"
                      >
                        <Pill className="w-3.5 h-3.5 text-gray-400" />
                        Prescribe Medicine (Doctor Only)
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenFinance(adm)}
                      className="flex-grow px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold shadow-sm transition-all text-center"
                    >
                      💰 Financials &amp; Transfer
                    </button>
                    {isDoctorOrAdmin && (
                      <button
                        onClick={() => handleOpenTherapy(adm)}
                        className="flex-grow px-4 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold shadow-sm transition-all text-center"
                      >
                        💆 Recommend Therapy
                      </button>
                    )}
                    {isDoctorOrAdmin ? (
                      <button
                        onClick={() => handleInitiateDischarge(adm)}
                        className="flex-grow px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all text-center"
                      >
                        Discharge Patient
                      </button>
                    ) : (
                      <button
                        disabled
                        className="flex-grow px-4 py-2 bg-gray-100 border border-gray-200 text-gray-400 rounded-lg text-xs font-semibold transition-all text-center cursor-not-allowed"
                        title="Only users with Doctor role can approve discharge"
                      >
                        Discharge (Doctor Only)
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
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-gray-100 overflow-hidden transform scale-100 transition-transform">
            <div className="bg-red-700 text-white px-6 py-4">
              <h3 className="font-bold text-lg">Doctor Discharge Handoff</h3>
              <p className="text-xs text-red-100">
                Patient: {dischargingAdmission.visit.employee.name} (ID: {dischargingAdmission.visit.employee.employeeId})
              </p>
            </div>

            <form onSubmit={handleDischargeSubmit} className="p-6 space-y-4">
              {dischargeLedgerLoading && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span>Checking patient financial ledger for pending charges...</span>
                </div>
              )}

              {dischargeLedgerError && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                  <span>Notice: Could not check ledger balance ({dischargeLedgerError}).</span>
                </div>
              )}

              {dischargeOutstandingBalance !== null && dischargeOutstandingBalance > 0 && (
                <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-xs flex-shrink-0 mt-0.5">
                      !
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-amber-900 text-sm">
                        Outstanding Balance Warning
                      </div>
                      <div className="text-xs text-amber-900 mt-1 leading-relaxed">
                        Patient has an outstanding balance of{' '}
                        <span className="font-black text-red-700 text-sm">
                          ₹{dischargeOutstandingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>{' '}
                        in pending charges. Please collect payment before discharge.
                      </div>
                      <p className="text-[11px] text-amber-700 mt-1">
                        Clinical discharge will not be blocked. You can settle dues at the Patient Ledger or proceed with discharge if medically required.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const empId = dischargingAdmission.visit.employee.employeeId;
                        setDischargingAdmission(null);
                        setDischargeOutstandingBalance(null);
                        navigate(`/patient-ledger?search=${encodeURIComponent(empId)}`);
                        if (onNavigate) onNavigate('patient-ledger');
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
                    >
                      <IndianRupee className="w-3.5 h-3.5" />
                      <span>Go to Patient Ledger</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

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

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div>
                  {dischargeOutstandingBalance !== null && dischargeOutstandingBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const empId = dischargingAdmission.visit.employee.employeeId;
                        setDischargingAdmission(null);
                        setDischargeOutstandingBalance(null);
                        navigate(`/patient-ledger?search=${encodeURIComponent(empId)}`);
                        if (onNavigate) onNavigate('patient-ledger');
                      }}
                      className="px-3.5 py-2 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      <IndianRupee className="w-3.5 h-3.5 text-amber-700" />
                      Go to Patient Ledger
                    </button>
                  )}
                </div>

                <div className="flex items-center space-x-3 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setDischargingAdmission(null);
                      setDischargeOutstandingBalance(null);
                      setDischargeLedgerError(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingDischarge || !summaryText.trim()}
                    className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {submittingDischarge
                      ? 'Discharging...'
                      : dischargeOutstandingBalance !== null && dischargeOutstandingBalance > 0
                      ? 'Continue Discharge'
                      : 'Approve Discharge & Free Bed'}
                  </button>
                </div>
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
      {recentlyDischarged && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center p-4 z-[60] backdrop-blur-sm print:static print:bg-transparent print:p-0">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full border border-gray-100 overflow-hidden flex flex-col max-h-[90vh] print:shadow-none print:border-none print:max-w-full print:max-h-full">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 print:hidden">
              <h2 className="font-bold text-lg text-gray-800">Discharge Card Generated</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setTimeout(() => window.print(), 100)}
                  className="px-4 py-2 bg-esic-secondary hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  🖨️ Print Card
                </button>
                <button
                  onClick={() => setRecentlyDischarged(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 text-gray-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto print:p-0 print:overflow-visible text-black bg-white">
              <div className="text-center mb-6 border-b-2 border-black pb-4">
                <h1 className="text-2xl font-bold uppercase tracking-wider mb-1">{hospitalName}</h1>
                <h2 className="text-lg font-semibold uppercase mb-1">Inpatient Discharge Card</h2>
                <p className="text-sm">Ministry of Labour &amp; Employment, Govt. of India</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
                <div>
                  <p className="mb-1"><span className="font-bold">Patient Name:</span> {recentlyDischarged.visit.employee.name}</p>
                  <p className="mb-1"><span className="font-bold">Employee ID:</span> {recentlyDischarged.visit.employee.employeeId}</p>
                  <p className="mb-1"><span className="font-bold">Department:</span> {recentlyDischarged.visit.employee.department}</p>
                  <p className="mb-1"><span className="font-bold">Category:</span> {recentlyDischarged.eligibleCategory}</p>
                </div>
                <div className="text-right">
                  <p className="mb-1"><span className="font-bold">Admission Date:</span> {recentlyDischarged.allocatedAt ? formatDateDefault(recentlyDischarged.allocatedAt) : 'N/A'}</p>
                  <p className="mb-1"><span className="font-bold">Discharge Date:</span> {formatDateDefault(new Date())}</p>
                  <p className="mb-1"><span className="font-bold">Ward/Bed:</span> Bed {recentlyDischarged.bed?.bedNumber || 'Unassigned'}</p>
                  <p className="mb-1"><span className="font-bold">Attending Doctor:</span> {recentlyDischarged.assignedDoctor?.employee?.name || recentlyDischarged.assignedDoctor?.identifier || 'N/A'}</p>
                </div>
              </div>

              <div className="mb-8 p-4 bg-gray-50 border border-gray-200 rounded-lg print:bg-white print:border-black print:rounded-none">
                <h3 className="font-bold text-base border-b border-gray-300 pb-2 mb-3 uppercase tracking-wide">Discharge Summary</h3>
                <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-800 print:text-black">{printSummary}</p>
              </div>

              {recentlyDischarged.notes && recentlyDischarged.notes.length > 0 && (
                <div className="mb-8">
                  <h3 className="font-bold text-base border-b border-gray-300 pb-2 mb-3 uppercase tracking-wide">Clinical Observation Notes (During IPD)</h3>
                  <div className="space-y-4">
                    {recentlyDischarged.notes.map((note) => (
                      <div key={note.id} className="text-sm border-l-2 border-gray-300 pl-3 py-1 print:border-black">
                        <span className="text-xs text-gray-500 font-semibold print:text-black">{formatDateTimeDefault(note.createdAt)} (By {note.author.identifier}):</span>
                        <p className="mt-1 text-gray-800 print:text-black">{note.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-16 flex justify-between text-sm font-bold pt-4">
                <div className="text-center">
                  <p>_______________________</p>
                  <p className="mt-2">Patient / Relative Signature</p>
                </div>
                <div className="text-center">
                  <p>_______________________</p>
                  <p className="mt-2">Doctor / Medical Officer Signature</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Financial Summary / Bed Transfer / Location History Modal (Feature 8/9) */}
      {financeAdmission && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {financeAdmission.visit.employee.name}
                </h3>
                <p className="text-xs text-gray-500 font-mono">{financeAdmission.visit.employee.employeeId}</p>
              </div>
              <button
                onClick={() => setFinanceAdmission(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex gap-1 px-5 pt-3 border-b border-gray-200">
              {(['summary', 'transfer', 'history'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFinanceTab(t)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-lg ${
                    financeTab === t
                      ? 'bg-esic-primary text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {t === 'summary' ? '💰 Financial Summary' : t === 'transfer' ? '🛏️ Transfer Bed' : '📍 Location History'}
                </button>
              ))}
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs">
              {financeLoading ? (
                <p className="text-center text-gray-500 py-8">Loading…</p>
              ) : (
                <>
                  {financeTab === 'summary' && financeSummary && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Gross', value: financeSummary.summary.totalAmount, tone: 'text-gray-900' },
                          { label: 'Paid', value: financeSummary.summary.paidAmount, tone: 'text-green-700' },
                          {
                            label: 'Outstanding',
                            value: financeSummary.summary.outstandingAmount,
                            tone: Number(financeSummary.summary.outstandingAmount) > 0 ? 'text-red-700' : 'text-gray-500',
                          },
                        ].map((tile) => (
                          <div key={tile.label} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="text-[10px] font-semibold text-gray-500 uppercase">{tile.label}</div>
                            <div className={`mt-1 text-base font-bold tabular-nums ${tile.tone}`}>
                              ₹{Number(tile.value).toLocaleString('en-IN')}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="min-w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Date</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Description</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-600">Amount</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {financeSummary.lineItems.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                                  No charges posted yet for this admission.
                                </td>
                              </tr>
                            ) : (
                              financeSummary.lineItems.map((li, i) => (
                                <tr key={i}>
                                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                                    {formatDateIN(li.date)}
                                  </td>
                                  <td className="px-3 py-2 text-gray-800">{li.description}</td>
                                  <td className="px-3 py-2 text-right font-mono">₹{Number(li.netAmount).toLocaleString('en-IN')}</td>
                                  <td className="px-3 py-2">{li.status}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {financeTab === 'transfer' && (
                    <div className="space-y-3">
                      {!canTransfer ? (
                        <p className="text-gray-500">Only Nursing, Admission Desk or Administration staff can transfer a patient's bed.</p>
                      ) : (
                        <>
                          <p className="text-gray-500">
                            Current bed: <strong>{financeAdmission.bed?.bedNumber || 'Unassigned'}</strong>
                          </p>
                          <select
                            value={transferBedId}
                            onChange={(e) => setTransferBedId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          >
                            <option value="">-- Select destination bed (same eligibility category) --</option>
                            {eligibleBedsForTransfer.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.room.ward.name} · Room {b.room.roomNumber} · Bed {b.bedNumber}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Reason for transfer (required)"
                            value={transferReason}
                            onChange={(e) => setTransferReason(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                          <button
                            onClick={handleTransferSubmit}
                            disabled={!transferBedId || transferReason.trim().length < 3 || transferSubmitting}
                            className="px-4 py-2 bg-esic-primary text-white rounded-lg font-semibold disabled:opacity-50"
                          >
                            {transferSubmitting ? 'Transferring…' : 'Confirm Transfer'}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {financeTab === 'history' && (
                    <div className="space-y-2">
                      {locationHistory.length === 0 ? (
                        <p className="text-gray-500">No bed transfers recorded for this admission.</p>
                      ) : (
                        locationHistory.map((h) => (
                          <div key={h.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1">
                            <div className="flex justify-between text-[11px] text-gray-400">
                              <span>By: {h.movedBy.identifier}</span>
                              <span>{formatDateTimeIN(h.movedAt)}</span>
                            </div>
                            <p className="text-gray-800">
                              {h.fromBed ? `${h.fromWard?.name} / Bed ${h.fromBed.bedNumber}` : 'Initial admission'}
                              {' → '}
                              <strong>{h.toWard?.name} / Bed {h.toBed?.bedNumber}</strong>
                            </p>
                            <p className="text-gray-500 italic">Reason: {h.reason}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recommend Therapy Modal (IPD entry point 3) */}
      {therapyAdmission && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  💆 Recommend Therapy — {therapyAdmission.visit.employee.name}
                </h3>
                <p className="text-xs text-gray-500 font-mono">
                  {therapyAdmission.visit.employee.employeeId} · Admission {therapyAdmission.id.slice(0, 8)}
                </p>
              </div>
              <button onClick={() => setTherapyAdmission(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
                ×
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs space-y-4">
              {therapyMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-semibold">
                  {therapyMessage}
                </div>
              )}

              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-2">
                <label className="text-xs font-bold text-emerald-900 block">Select Therapy / Course *</label>
                <select
                  value={selectedTherapyServiceId}
                  onChange={(e) => setSelectedTherapyServiceId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                >
                  <option value="">-- Select from Therapy Catalogue --</option>
                  {therapyServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.currentPrice ? `— ₹${s.currentPrice}` : '(unpriced)'} [{s.unit}]
                    </option>
                  ))}
                </select>
                {selectedTherapyService?.unit === 'COURSE' && (
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={therapyPlannedSessions}
                    onChange={(e) => setTherapyPlannedSessions(Number(e.target.value))}
                    className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg text-xs"
                    placeholder="Planned sessions"
                  />
                )}
                <button
                  onClick={handleRecommendIpdTherapy}
                  disabled={!selectedTherapyServiceId || therapyBooking}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {therapyBooking
                    ? 'Recommending…'
                    : selectedTherapyService?.unit === 'COURSE'
                      ? 'Open Therapy Course'
                      : 'Schedule Therapy Session'}
                </button>
              </div>

              <div className="space-y-2">
                <p className="font-bold text-gray-700">Therapy Already Recommended This Admission</p>
                {therapyLoading ? (
                  <p className="text-gray-400 text-center py-4">Loading…</p>
                ) : existingTherapyCourses.length === 0 && existingTherapySessions.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">None yet.</p>
                ) : (
                  <>
                    {existingTherapyCourses.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                        <span className="font-semibold text-gray-800">{c.service.name}</span>
                        <span className="text-[10px] font-bold text-gray-500">{c.status}</span>
                      </div>
                    ))}
                    {existingTherapySessions
                      .filter((s) => !s.courseId)
                      .map((s) => (
                        <div key={s.id} className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                          <span className="font-semibold text-gray-800">{s.service.name}</span>
                          <span className="text-[10px] font-bold text-gray-500">{s.status}</span>
                        </div>
                      ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Laboratory Test Modal (IPD Laboratory Entry Point) */}
      {labAdmission && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <TestTube className="w-5 h-5 text-sky-600" />
                  Order Laboratory Test — {labAdmission.visit.employee.name}
                </h3>
                <p className="text-xs text-gray-500 font-mono">
                  {labAdmission.visit.employee.employeeId} · Bed: {labAdmission.bed?.bedNumber || 'Unassigned'} · Admission {labAdmission.id.slice(0, 8)}
                </p>
              </div>
              <button
                onClick={() => setLabAdmission(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs space-y-4">
              {labMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-semibold">
                  {labMessage}
                </div>
              )}

              {labError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg font-semibold">
                  {labError}
                </div>
              )}

              <div className="p-3.5 rounded-xl border border-sky-200 bg-sky-50/50 space-y-3">
                <label className="text-xs font-bold text-sky-900 block">
                  Select Test from Laboratory Master *
                </label>

                <div className="flex gap-2">
                  <select
                    value={labTestPicker}
                    onChange={(e) => setLabTestPicker(e.target.value)}
                    disabled={labSubmitting || labLoading}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white flex-1"
                  >
                    <option value="">-- Select from Lab Test Master --</option>
                    {availableLabTests
                      .filter((t) => !selectedLabTestIds.includes(t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.discipline.replace(/_/g, ' ')})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddLabTest}
                    disabled={!labTestPicker || labSubmitting}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                {/* Selected Tests Tags */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedLabTestIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-100 text-sky-800 text-xs font-medium border border-sky-200"
                    >
                      {labTestName(id)}
                      <button
                        type="button"
                        onClick={() => handleRemoveLabTest(id)}
                        className="hover:text-red-600 ml-1 font-bold text-sm leading-none"
                        title="Remove test"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {selectedLabTestIds.length === 0 && (
                    <p className="text-[11px] text-gray-500">
                      Select one or more investigations from the catalog above to add to this order.
                    </p>
                  )}
                </div>

                {/* Priority and Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Order Priority
                    </label>
                    <select
                      value={labPriority}
                      onChange={(e) => setLabPriority(e.target.value as 'ROUTINE' | 'URGENT' | 'STAT')}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="ROUTINE">Routine</option>
                      <option value="URGENT">Urgent</option>
                      <option value="STAT">STAT (Immediate Emergency)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Clinical Indication / Notes (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Pre-op investigation, fever workup"
                      value={labClinicalNotes}
                      onChange={(e) => setLabClinicalNotes(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSubmitLabOrder}
                    disabled={selectedLabTestIds.length === 0 || labSubmitting}
                    className="w-full px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold text-xs shadow-sm transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <TestTube className="w-4 h-4" />
                    {labSubmitting
                      ? 'Submitting Laboratory Order...'
                      : `Submit Laboratory Order (${selectedLabTestIds.length} Test${selectedLabTestIds.length === 1 ? '' : 's'})`}
                  </button>
                </div>
              </div>

              {/* Already Ordered Tests for this Admission/Visit */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between border-b border-gray-200 pb-1.5">
                  <p className="font-bold text-gray-700">
                    Laboratory Orders for This Admission ({existingLabOrders.length})
                  </p>
                  <span className="text-[10px] text-gray-400">Live Laboratory Queue</span>
                </div>

                {labLoading ? (
                  <p className="text-gray-400 text-center py-4">Loading laboratory records...</p>
                ) : existingLabOrders.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">No laboratory tests ordered yet for this admission.</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {existingLabOrders.map((ord) => (
                      <div key={ord.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-sky-800">
                              {ord.labNumber || ord.id.slice(0, 8)}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                ord.priority === 'STAT'
                                  ? 'bg-red-100 text-red-800'
                                  : ord.priority === 'URGENT'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {ord.priority}
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {ord.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {ord.items.map((item) => (
                            <span
                              key={item.id}
                              className="bg-white border border-gray-200 px-2 py-0.5 rounded text-[11px] text-gray-800 font-medium"
                            >
                              {item.labTest?.name || 'Investigation'}
                            </span>
                          ))}
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-400 pt-0.5">
                          <span>Ordered: {formatDateTimeDefault(ord.createdAt)}</span>
                          {ord.orderingDoctor && <span>Doctor: {ord.orderingDoctor.employee?.name || ord.orderingDoctor.identifier}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prescribe Medicine Modal (IPD Prescription Entry Point) */}
      {rxAdmission && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Pill className="w-5 h-5 text-indigo-600" />
                  Prescribe Medicine — {rxAdmission.visit.employee.name}
                </h3>
                <p className="text-xs text-gray-500 font-mono">
                  {rxAdmission.visit.employee.employeeId} · Bed: {rxAdmission.bed?.bedNumber || 'Unassigned'} · Admission {rxAdmission.id.slice(0, 8)}
                </p>
              </div>
              <button
                onClick={() => setRxAdmission(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs space-y-4">
              {rxMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-semibold">
                  {rxMessage}
                </div>
              )}

              {rxError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg font-semibold">
                  {rxError}
                </div>
              )}

              {/* Clinical Indication / Diagnosis */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/50">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Primary Clinical Diagnosis / Indication *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Post-operative care, acute infection"
                    value={rxDiagnosis}
                    onChange={(e) => setRxDiagnosis(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Symptoms / Clinical Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Fever with chills, post-surgical pain"
                    value={rxSymptoms}
                    onChange={(e) => setRxSymptoms(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>

              {/* Medicine Prescription Items */}
              <div className="space-y-3 p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                  <label className="text-xs font-bold text-indigo-900 block">
                    Prescribed Medicines (from Inventory Stock) *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddRxItem}
                    disabled={rxSubmitting}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Medicine
                  </button>
                </div>

                <div className="space-y-2.5">
                  {rxItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-gray-200 bg-white space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <select
                          value={item.medicineName}
                          onChange={(e) => handleRxItemChange(idx, 'medicineName', e.target.value)}
                          disabled={rxSubmitting || rxLoading}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-xs bg-white flex-1 truncate font-medium"
                        >
                          <option value="">-- Select Available Stock Medicine --</option>
                          {availableMedicines.map((m) => {
                            const label = `${m.genericName}${m.brandName ? ` (${m.brandName})` : ''} - ${m.strength}`;
                            return (
                              <option key={m.id} value={m.genericName}>
                                {label}
                              </option>
                            );
                          })}
                        </select>

                        {rxItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRxItem(idx)}
                            disabled={rxSubmitting}
                            className="p-1 text-red-500 hover:text-red-700 rounded transition-all"
                            title="Remove medicine"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Dose</label>
                          <input
                            type="text"
                            placeholder="e.g. 1 Tablet"
                            value={item.dose}
                            onChange={(e) => handleRxItemChange(idx, 'dose', e.target.value)}
                            disabled={rxSubmitting}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Frequency</label>
                          <input
                            type="text"
                            placeholder="e.g. 1-0-1"
                            value={item.frequency}
                            onChange={(e) => handleRxItemChange(idx, 'frequency', e.target.value)}
                            disabled={rxSubmitting}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Duration</label>
                          <input
                            type="text"
                            placeholder="e.g. 5 Days"
                            value={item.duration}
                            onChange={(e) => handleRxItemChange(idx, 'duration', e.target.value)}
                            disabled={rxSubmitting}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Submission buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t border-indigo-100">
                  <button
                    type="button"
                    onClick={() => handleSubmitPrescription(false)}
                    disabled={rxSubmitting}
                    className="px-4 py-2 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {rxSubmitting ? 'Saving...' : 'Save as Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmitPrescription(true)}
                    disabled={rxSubmitting}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Pill className="w-3.5 h-3.5" />
                    {rxSubmitting ? 'Signing...' : 'Sign & Send to Pharmacy'}
                  </button>
                </div>
              </div>

              {/* Existing Prescriptions for this admission */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between border-b border-gray-200 pb-1.5">
                  <p className="font-bold text-gray-700">
                    Existing Prescriptions This Admission ({existingPrescriptions.length})
                  </p>
                  <span className="text-[10px] text-gray-400">Inpatient Prescription History</span>
                </div>

                {rxLoading ? (
                  <p className="text-gray-400 text-center py-4">Loading prescriptions...</p>
                ) : existingPrescriptions.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">No prescriptions logged yet for this visit.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {existingPrescriptions.map((p) => (
                      <div key={p.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-indigo-900">
                            Prescription {p.id.slice(0, 8)}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              p.status === 'SIGNED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.status === 'PARTIALLY_DISPENSED'
                                  ? 'bg-amber-100 text-amber-800'
                                  : p.status === 'CLOSED'
                                    ? 'bg-gray-100 text-gray-700'
                                    : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {p.status}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {p.items?.map((it: any) => (
                            <div key={it.id} className="flex justify-between text-[11px] text-gray-700 bg-white p-1.5 rounded border border-gray-200">
                              <span className="font-semibold">{it.medicineName}</span>
                              <span className="text-gray-500 font-mono">{it.dose} · {it.frequency} · {it.duration}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
