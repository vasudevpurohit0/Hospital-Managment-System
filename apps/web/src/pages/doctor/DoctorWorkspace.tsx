import React, { useState, useEffect, useCallback } from 'react';
import {
  createPrescription,
  signPrescription,
  PrescriptionItemPayload,
  PrescriptionRecord,
} from '../../api/prescription.api';
import { evaluateBenefitRule } from '../../api/benefit.api';
import { fetchVisitById, lookupPatientByUid, VisitDetail } from '../../api/patient-lookup.api';
import { searchPatients, createPatientVisit } from '../../api/patient.api';
import { fetchDepartments, Department } from '../../api/opd.api';
import { fetchBranding } from '../../api/security.api';
import { fetchMedicines, MedicineRecord } from '../../api/inventory.api';
import { fetchLabTests, fetchLabQueue, LabTestSummary, LabOrderRecord } from '../../api/lab.api';
import { fetchServices, ServiceListItem } from '../../api/catalog.api';
import {
  fetchTherapySessions,
  fetchTherapyCourses,
  openTherapyCourse,
  scheduleTherapySession,
  TherapySessionRecord,
  TherapyCourseRecord,
} from '../../api/therapy.api';
import {
  User,
  Stethoscope,
  Plus,
  Trash2,
  Lock,
  Save,
  FileText,
  Edit,
  List,
  Printer,
  Microscope,
  Activity,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';

interface DoctorWorkspaceProps {
  authToken: string;
}

interface RxItemState extends PrescriptionItemPayload {
  mode: 'SELECT' | 'CUSTOM';
}

export const DoctorWorkspace: React.FC<DoctorWorkspaceProps> = ({ authToken }) => {
  const [visitIdInput, setVisitIdInput] = useState('');
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [visitLoading, setVisitLoading] = useState(false);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [benefitOutcome, setBenefitOutcome] = useState<'FREE' | 'COVERED' | 'PAID' | null>(null);

  const [symptoms, setSymptoms] = useState('');
  const [examinationNotes, setExaminationNotes] = useState('');
  const [diagnosisText, setDiagnosisText] = useState('');
  const [followUpFlag, setFollowUpFlag] = useState(false);
  const [admissionRecommended, setAdmissionRecommended] = useState(false);

  const [availableMedicines, setAvailableMedicines] = useState<MedicineRecord[]>([]);
  const [items, setItems] = useState<RxItemState[]>([
    { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days', mode: 'SELECT' },
  ]);

  /* Diagnostic Lab Orders — real Lab Test Master catalogue (Feature 6), never free text. */
  const [availableLabTests, setAvailableLabTests] = useState<LabTestSummary[]>([]);
  const [selectedLabTestIds, setSelectedLabTestIds] = useState<string[]>([]);
  const [labTestPicker, setLabTestPicker] = useState('');
  const [existingLabOrders, setExistingLabOrders] = useState<LabOrderRecord[]>([]);
  const [labOrdersLoading, setLabOrdersLoading] = useState(false);

  /* Recommend Therapy — OPD entry point 2, straight from the consultation. */
  const [availableTherapyServices, setAvailableTherapyServices] = useState<ServiceListItem[]>([]);
  const [selectedTherapyServiceId, setSelectedTherapyServiceId] = useState('');
  const [therapyPlannedSessions, setTherapyPlannedSessions] = useState(1);
  const [existingTherapySessions, setExistingTherapySessions] = useState<TherapySessionRecord[]>([]);
  const [existingTherapyCourses, setExistingTherapyCourses] = useState<TherapyCourseRecord[]>([]);
  const [therapyLoading, setTherapyLoading] = useState(false);
  const [recommendingTherapy, setRecommendingTherapy] = useState(false);

  const [activePrescription, setActivePrescription] = useState<PrescriptionRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authToken) {
      fetchMedicines(authToken)
        .then((meds) => setAvailableMedicines(meds))
        .catch((err) => console.error('Failed to load medicines catalog', err));
      fetchLabTests(authToken)
        .then((tests) => setAvailableLabTests(tests))
        .catch((err) => console.error('Failed to load lab test catalogue', err));
      fetchServices({ serviceType: 'THERAPY', active: true, limit: 100 }, authToken)
        .then((res) => setAvailableTherapyServices(res.items))
        .catch((err) => console.error('Failed to load therapy catalogue', err));
    }
  }, [authToken]);

  const loadExistingLabOrders = useCallback(
    async (visitId: string) => {
      setLabOrdersLoading(true);
      try {
        const orders = await fetchLabQueue(authToken, { visitId });
        setExistingLabOrders(orders);
      } catch (err) {
        console.error('Failed to load lab orders for visit', err);
      } finally {
        setLabOrdersLoading(false);
      }
    },
    [authToken],
  );

  const loadExistingTherapy = useCallback(
    async (visitId: string) => {
      setTherapyLoading(true);
      try {
        const [sessions, courses] = await Promise.all([
          fetchTherapySessions(authToken, { visitId }),
          fetchTherapyCourses(authToken, { visitId }),
        ]);
        setExistingTherapySessions(sessions);
        setExistingTherapyCourses(courses);
      } catch (err) {
        console.error('Failed to load therapy for visit', err);
      } finally {
        setTherapyLoading(false);
      }
    },
    [authToken],
  );

  const selectedTherapyService = availableTherapyServices.find((s) => s.id === selectedTherapyServiceId);

  const handleRecommendTherapy = async () => {
    if (!visit || !selectedTherapyServiceId) return;
    setRecommendingTherapy(true);
    setError(null);
    try {
      if (selectedTherapyService?.unit === 'COURSE') {
        await openTherapyCourse(
          { visitId: visit.id, serviceId: selectedTherapyServiceId, plannedSessions: therapyPlannedSessions },
          authToken,
        );
        setSuccessMessage(`Therapy course recommended: ${selectedTherapyService.name}.`);
      } else {
        await scheduleTherapySession({ visitId: visit.id, serviceId: selectedTherapyServiceId }, authToken);
        setSuccessMessage(`Therapy session recommended: ${selectedTherapyService?.name}.`);
      }
      setSelectedTherapyServiceId('');
      await loadExistingTherapy(visit.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recommend therapy');
    } finally {
      setRecommendingTherapy(false);
    }
  };

  const employmentTypeCode = visit?.employee.employmentType.code;

  useEffect(() => {
    if (!employmentTypeCode) {
      setBenefitOutcome(null);
      return;
    }
    evaluateBenefitRule(employmentTypeCode as 'PERMANENT' | 'CONTRACTUAL', undefined, authToken)
      .then((res) => setBenefitOutcome(res.outcome))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to evaluate benefit rule');
      });
  }, [employmentTypeCode, authToken]);

  const handleLoadVisit = useCallback(
    async (e?: React.FormEvent | string) => {
      // Accepts either a form submit event (manual "Load" click) or a plain
      // visit id string (auto-load from the OPD Queue's "Start Consultation"
      // link) — either way we resolve one concrete id to fetch.
      const explicitId = typeof e === 'string' ? e : undefined;
      if (e && typeof e !== 'string') e.preventDefault();

      const idToLoad = (explicitId ?? visitIdInput).trim();
      if (!idToLoad) return;

      setVisitLoading(true);
      setVisitError(null);
      setVisit(null);
      setActivePrescription(null);

      try {
        const res = await fetchVisitById(idToLoad, authToken);
        setVisit(res);
        setVisitIdInput(idToLoad);
        await Promise.all([loadExistingLabOrders(res.id), loadExistingTherapy(res.id)]);
      } catch (err: unknown) {
        setVisitError(err instanceof Error ? err.message : 'Failed to load visit');
      } finally {
        setVisitLoading(false);
      }
    },
    [visitIdInput, authToken, loadExistingLabOrders, loadExistingTherapy],
  );

  /* ── Find an existing patient without knowing their Visit ID ──
   * The Visit ID box above only works if the doctor already has today's
   * visit id in hand (e.g. from the OPD Queue). This lets them instead
   * search by name/mobile/UHID/Employee ID, then either jumps straight to
   * that patient's already-open visit, or — if they have none today —
   * offers to start one on the spot. */
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState<string | null>(null);
  const [patientSearchResults, setPatientSearchResults] = useState<
    { id: string; name: string; hospitalUid: string; employeeId: string; department: string }[]
  >([]);
  const [noOpenVisitFor, setNoOpenVisitFor] = useState<{ employeeId: string; name: string } | null>(null);
  const [startingVisit, setStartingVisit] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newVisitDepartmentId, setNewVisitDepartmentId] = useState('');
  const [hospitalName, setHospitalName] = useState('ESIC Model Hospital & ODC');

  useEffect(() => {
    fetchBranding()
      .then((b) => b.hospitalName && setHospitalName(b.hospitalName))
      .catch(() => {
        // Non-fatal: the printed consultation report falls back to the default hospital name.
      });
  }, []);

  useEffect(() => {
    fetchDepartments(authToken)
      .then((depts) => {
        setDepartments(depts);
        if (depts.length > 0) setNewVisitDepartmentId(depts[0].id);
      })
      .catch(() => {
        // Non-fatal: the Start New Visit button falls back to the hospital's default department.
      });
  }, [authToken]);

  const resolveAndLoadPatient = useCallback(
    async (identifier: string) => {
      setPatientSearchError(null);
      setNoOpenVisitFor(null);
      const found = await lookupPatientByUid(identifier, authToken);
      if (found.openVisit) {
        await handleLoadVisit(found.openVisit.id);
        setPatientSearchResults([]);
      } else {
        // Nothing open today — a new consultation needs a new visit first,
        // rather than silently reopening/editing an old closed one.
        setNoOpenVisitFor({ employeeId: found.employee.employeeId, name: found.employee.name });
        setPatientSearchResults([]);
      }
    },
    [authToken, handleLoadVisit],
  );

  const handlePatientSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientSearchQuery.trim()) return;
    setPatientSearching(true);
    setPatientSearchError(null);
    setNoOpenVisitFor(null);
    try {
      const res = await searchPatients({ query: patientSearchQuery.trim(), limit: 8 }, authToken);
      const items: any[] = res?.items || [];
      if (items.length === 0) {
        setPatientSearchError(`No patient found matching "${patientSearchQuery.trim()}"`);
        setPatientSearchResults([]);
      } else if (items.length === 1) {
        await resolveAndLoadPatient(items[0].hospitalUid !== '—' ? items[0].hospitalUid : items[0].employeeId);
      } else {
        setPatientSearchResults(
          items.map((it) => ({
            id: it.id,
            name: it.name,
            hospitalUid: it.hospitalUid,
            employeeId: it.employeeId,
            department: it.department,
          })),
        );
      }
    } catch (err: unknown) {
      setPatientSearchError(err instanceof Error ? err.message : 'Patient search failed');
    } finally {
      setPatientSearching(false);
    }
  };

  const handleStartNewVisitForPatient = async () => {
    if (!noOpenVisitFor) return;
    setStartingVisit(true);
    setPatientSearchError(null);
    try {
      const res = await createPatientVisit(
        {
          employeeId: noOpenVisitFor.employeeId,
          type: 'OPD',
          departmentId: newVisitDepartmentId || undefined,
        },
        authToken,
      );
      if (res.status === 'CREATED' && res.visit) {
        setNoOpenVisitFor(null);
        await handleLoadVisit(res.visit.id);
      } else if (res.status === 'OPEN_VISIT_WARNING' && res.openVisit) {
        // Race: a visit was opened for them between our search and this
        // click (e.g. Reception just issued a token) — load that one.
        await handleLoadVisit(res.openVisit.id);
        setNoOpenVisitFor(null);
      }
    } catch (err: unknown) {
      setPatientSearchError(err instanceof Error ? err.message : 'Failed to start a new visit');
    } finally {
      setStartingVisit(false);
    }
  };

  /** Deep-link support: OPD Queue's "Start Consultation" button navigates to
   *  /consultations?visitId=<id> — load that patient immediately instead of
   *  making the doctor copy/paste the Visit ID by hand. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedVisitId = params.get('visitId');
    if (linkedVisitId) {
      handleLoadVisit(linkedVisitId);
    }
    // Intentionally run once on mount only — handleLoadVisit's own
    // dependencies would otherwise re-trigger this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddItem = () => {
    setItems([
      ...items,
      { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days', mode: 'SELECT' },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const toggleItemMode = (index: number) => {
    const updated = [...items];
    const newMode = updated[index].mode === 'SELECT' ? 'CUSTOM' : 'SELECT';
    updated[index] = { ...updated[index], mode: newMode };
    setItems(updated);
  };

  const handleItemChange = (
    index: number,
    field: keyof RxItemState,
    value: string,
  ) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
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

  const handleSaveDraft = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!visit) {
      setError('Load a Visit ID before saving a prescription draft.');
      return;
    }

    if (!diagnosisText.trim()) {
      setError('Primary Clinical Diagnosis is required before saving a prescription.');
      return;
    }

    const validItems = items
      .filter((i) => i.medicineName && i.medicineName.trim() !== '')
      .map(({ medicineName, dose, frequency, duration }) => ({
        medicineName: medicineName.trim(),
        dose: dose.trim() || '1 Tablet',
        frequency: frequency.trim() || '1-0-1',
        duration: duration.trim() || '5 Days',
      }));

    if (validItems.length === 0 && selectedLabTestIds.length === 0 && !admissionRecommended) {
      setError(
        'Please add at least one medicine, order a lab test, or tick "Recommend Admission" before saving.',
      );
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const res = await createPrescription(
        {
          visitId: visit.id,
          symptoms: symptoms.trim() || undefined,
          examinationNotes: examinationNotes.trim() || undefined,
          diagnosisText: diagnosisText.trim(),
          followUpFlag,
          admissionRecommended,
          items: validItems,
          labTestIds: selectedLabTestIds.length > 0 ? selectedLabTestIds : undefined,
        },
        authToken,
      );

      setActivePrescription(res.prescription);
      setSuccessMessage(
        selectedLabTestIds.length > 0
          ? `Prescription draft saved. ${selectedLabTestIds.length} lab test(s) ordered.`
          : 'Prescription draft saved in DRAFT state.',
      );
      setSelectedLabTestIds([]);
      await loadExistingLabOrders(visit.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignPrescription = async () => {
    if (!activePrescription) {
      setError('Please save the prescription draft first before signing.');
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const signed = await signPrescription(activePrescription.id, authToken);
      setActivePrescription(signed);
      setSuccessMessage('Prescription digitally signed & locked permanently.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign prescription');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const isSigned = activePrescription?.status === 'SIGNED';

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      {/* ─── PRINT-ONLY DEDICATED CONSULTATION REPORT ─── */}
      <div className="hidden print:block consultation-print-only">
        <div className="border-b-2 border-black pb-4 mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wider text-black">
              {hospitalName}
            </h1>
            <p className="text-xs text-gray-700 font-semibold">
              Ministry of Labour & Employment, Govt. of India
            </p>
            <h2 className="text-sm font-bold text-primary-900 mt-1">
              DOCTOR CLINICAL CONSULTATION & DIAGNOSIS REPORT
            </h2>
          </div>
          <div className="text-right text-xs">
            <p><strong>Visit ID:</strong> {visit?.id || visitIdInput || 'CONSULT-DRAFT'}</p>
            <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')}</p>
            <p><strong>Status:</strong> {isSigned ? 'SIGNED & LOCKED' : 'DRAFT'}</p>
          </div>
        </div>

        {/* Patient Details */}
        <div className="border border-black p-3 mb-4 rounded bg-gray-50 text-xs grid grid-cols-2 gap-2">
          <div>
            <p><strong>Patient Name:</strong> {visit?.employee.name || 'N/A'}</p>
            <p><strong>Hospital UHID:</strong> {visit?.employee.hospitalUid?.uidCode || 'N/A'}</p>
            <p><strong>Department:</strong> {visit?.employee.department || 'General Medicine'}</p>
          </div>
          <div>
            <p><strong>Employment Type:</strong> {visit?.employee.employmentType.name || 'Permanent'}</p>
            <p><strong>ESIC Coverage:</strong> {benefitOutcome === 'PAID' ? 'Self Paid' : 'ESIC 100% Covered'}</p>
            <p><strong>Consultation Time:</strong> {new Date().toLocaleTimeString('en-IN', { timeStyle: 'short' })}</p>
          </div>
        </div>

        {/* Clinical Examination */}
        <div className="mb-4 text-xs">
          <h3 className="font-bold text-sm border-b border-gray-400 pb-1 mb-2 uppercase">
            Clinical Examination & Diagnosis
          </h3>
          <p className="mb-1"><strong>Symptoms & History:</strong> {symptoms || 'None recorded'}</p>
          <p className="mb-1"><strong>Physical Examination:</strong> {examinationNotes || 'Normal'}</p>
          <p className="mb-1"><strong>Primary Clinical Diagnosis:</strong> <span className="font-bold underline">{diagnosisText || 'Pending'}</span></p>
          <p className="mt-2 text-gray-800">
            {followUpFlag && '✓ Schedule follow-up visit in 7 days. '}
            {admissionRecommended && '⚠️ IPD Admission Recommended.'}
          </p>
        </div>

        {/* Prescribed Medicines */}
        <div className="mb-4 text-xs">
          <h3 className="font-bold text-sm border-b border-gray-400 pb-1 mb-2 uppercase">
            Prescribed Medicines
          </h3>
          <table className="w-full border-collapse border border-gray-400 text-left text-xs">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-400 p-1.5">S.No</th>
                <th className="border border-gray-400 p-1.5">Medicine Name</th>
                <th className="border border-gray-400 p-1.5">Dose</th>
                <th className="border border-gray-400 p-1.5">Frequency</th>
                <th className="border border-gray-400 p-1.5">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.filter(i => i.medicineName.trim()).map((item, idx) => (
                <tr key={idx}>
                  <td className="border border-gray-400 p-1.5">{idx + 1}</td>
                  <td className="border border-gray-400 p-1.5 font-bold">{item.medicineName}</td>
                  <td className="border border-gray-400 p-1.5">{item.dose}</td>
                  <td className="border border-gray-400 p-1.5">{item.frequency}</td>
                  <td className="border border-gray-400 p-1.5">{item.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Diagnostic Lab Orders — real orders placed for this visit, not local mock data */}
        <div className="mb-4 text-xs">
          <h3 className="font-bold text-sm border-b border-gray-400 pb-1 mb-2 uppercase">
            Diagnostic Lab Orders
          </h3>
          {existingLabOrders.length > 0 ? (
            <table className="w-full border-collapse border border-gray-400 text-left text-xs mb-2">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-400 p-1.5">Lab No.</th>
                  <th className="border border-gray-400 p-1.5">Test(s)</th>
                  <th className="border border-gray-400 p-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {existingLabOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="border border-gray-400 p-1.5 font-mono">{o.labNumber ?? '—'}</td>
                    <td className="border border-gray-400 p-1.5 font-semibold">
                      {o.items.map((i) => i.labTest.name).join(', ')}
                    </td>
                    <td className="border border-gray-400 p-1.5 font-bold">{o.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600">No laboratory orders recorded for this visit.</p>
          )}

          {selectedLabTestIds.length > 0 && (
            <p className="mt-1">
              <strong>Newly Ordered (this draft):</strong>{' '}
              {selectedLabTestIds.map((id) => labTestName(id)).join(', ')}
            </p>
          )}
        </div>

        {/* Signature Box */}
        <div className="mt-8 pt-4 border-t border-black flex justify-between items-end text-xs">
          <div>
            <p><strong>Prescription ID:</strong> {activePrescription?.id || 'DRAFT'}</p>
            <p>Generated via ESIC HMS Real-Time Clinical Console</p>
          </div>
          <div className="text-center">
            <div className="w-32 h-10 border-b border-dashed border-black mb-1"></div>
            <p className="font-bold">Attending Medical Officer</p>
            <p className="text-[10px] text-gray-600">
              {isSigned ? 'Digitally Signed & Verified' : 'Draft Copy'}
            </p>
          </div>
        </div>
      </div>

      {/* ─── SCREEN DISPLAY (Hidden during printing) ─── */}
      <div className="print:hidden space-y-6">
        {/* Top Banner Status */}
        <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-600">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                Doctor Consultation & Prescription Console
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Epic EMR-style 3-panel split clinical workspace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-secondary btn-sm gap-1.5"
              title="Print Patient Consultation Details"
            >
              <Printer className="w-4 h-4 text-primary-600" />
              <span>Print Patient Details</span>
            </button>

            {isSigned ? (
              <Badge variant="success" dot className="px-3 py-1 text-xs">
                SIGNED & LOCKED
              </Badge>
            ) : activePrescription ? (
              <Badge variant="warning" dot className="px-3 py-1 text-xs">
                DRAFT (EDITABLE)
              </Badge>
            ) : (
              <Badge variant="neutral" className="px-3 py-1 text-xs">
                NEW CONSULTATION
              </Badge>
            )}
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {successMessage && <div className="alert alert-success">{successMessage}</div>}

        {/* 3-Panel Split Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Patient Banner & Context (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <div className="card p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Visit Context ID
                </label>
                <form onSubmit={handleLoadVisit} className="flex gap-1.5">
                  <input
                    type="text"
                    value={visitIdInput}
                    onChange={(e) => setVisitIdInput(e.target.value)}
                    placeholder="Enter Visit ID..."
                    disabled={isSigned}
                    className="input text-xs font-mono py-1.5 flex-1"
                  />
                  <button
                    type="submit"
                    disabled={visitLoading || isSigned || !visitIdInput.trim()}
                    className="btn btn-secondary btn-sm text-xs"
                  >
                    {visitLoading ? '...' : 'Load'}
                  </button>
                </form>
                {visitError && <p className="text-xs text-danger-600">{visitError}</p>}
              </div>

              <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Or Find an Existing Patient
                </label>
                <form onSubmit={handlePatientSearchSubmit} className="flex gap-1.5">
                  <input
                    type="text"
                    value={patientSearchQuery}
                    onChange={(e) => setPatientSearchQuery(e.target.value)}
                    placeholder="Name, mobile, UHID or Employee ID..."
                    disabled={isSigned}
                    className="input text-xs py-1.5 flex-1"
                  />
                  <button
                    type="submit"
                    disabled={patientSearching || isSigned || !patientSearchQuery.trim()}
                    className="btn btn-secondary btn-sm text-xs"
                  >
                    {patientSearching ? '...' : 'Find'}
                  </button>
                </form>
                {patientSearchError && <p className="text-xs text-danger-600">{patientSearchError}</p>}

                {patientSearchResults.length > 0 && (
                  <div className="border border-[var(--color-border)] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    {patientSearchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => resolveAndLoadPatient(r.hospitalUid !== '—' ? r.hospitalUid : r.employeeId)}
                        className="w-full text-left px-2.5 py-2 text-xs hover:bg-primary-50 dark:hover:bg-primary-900/20 border-b border-[var(--color-border)] last:border-b-0"
                      >
                        <span className="font-semibold">{r.name}</span>
                        <span className="block text-[10px] font-mono text-[var(--color-text-tertiary)]">
                          {r.hospitalUid} • {r.department}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {noOpenVisitFor && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-1.5">
                    <p className="text-[11px] text-amber-900 dark:text-amber-200">
                      <b>{noOpenVisitFor.name}</b> has no open visit today.
                    </p>
                    {departments.length > 0 && (
                      <select
                        value={newVisitDepartmentId}
                        onChange={(e) => setNewVisitDepartmentId(e.target.value)}
                        className="w-full text-[11px] rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-transparent px-2 py-1"
                        title="Department to route this new visit to"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={handleStartNewVisitForPatient}
                      disabled={startingVisit}
                      className="btn btn-secondary btn-sm text-xs w-full border-amber-400 text-amber-900 hover:bg-amber-100"
                    >
                      {startingVisit ? 'Starting...' : 'Start New OPD Visit for this Patient'}
                    </button>
                  </div>
                )}
              </div>

              {visit ? (
                <>
                  <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border)]">
                    <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[var(--color-text-primary)]">
                        {visit.employee.name}
                      </h3>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {visit.employee.department}
                      </p>
                      {visit.employee.hospitalUid && (
                        <p className="text-[10px] text-primary-600 font-mono font-semibold">
                          UHID: {visit.employee.hospitalUid.uidCode}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      ESIC Benefit Rule Engine
                    </p>
                    <p className="text-xs font-medium">
                      {visit.employee.employmentType.name} ({visit.employee.employmentType.code})
                    </p>
                    {benefitOutcome && (
                      <div className="pt-1">
                        <Badge variant={benefitOutcome === 'PAID' ? 'warning' : 'success'}>
                          {benefitOutcome === 'PAID' ? 'Self Paid' : 'ESIC 100% Covered'}
                        </Badge>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--color-text-tertiary)] py-4 text-center">
                  Load a Visit ID to view patient details.
                </p>
              )}
            </div>
          </div>

          {/* Center Panel: Clinical Findings & Diagnosis (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2.5 flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary-500" />
                Clinical Examination & Diagnosis
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Patient Symptoms & History
                </label>
                <textarea
                  rows={3}
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  disabled={isSigned}
                  className="input text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Physical Examination Findings
                </label>
                <textarea
                  rows={3}
                  value={examinationNotes}
                  onChange={(e) => setExaminationNotes(e.target.value)}
                  disabled={isSigned}
                  className="input text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Primary Clinical Diagnosis *
                </label>
                <input
                  type="text"
                  required
                  value={diagnosisText}
                  onChange={(e) => setDiagnosisText(e.target.value)}
                  disabled={isSigned}
                  className="input text-xs font-semibold"
                />
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={followUpFlag}
                    onChange={(e) => setFollowUpFlag(e.target.checked)}
                    disabled={isSigned}
                    className="rounded border-[var(--color-border-strong)] text-primary-500"
                  />
                  <span>Schedule follow-up visit in 7 days</span>
                </label>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={admissionRecommended}
                    onChange={(e) => setAdmissionRecommended(e.target.checked)}
                    disabled={isSigned}
                    className="rounded border-[var(--color-border-strong)] text-primary-500"
                  />
                  <span className="font-semibold text-danger-600">
                    Recommend Admission to IPD Ward
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Right Panel: Digital Rx, Lab Orders & Diagnosis Lab Results (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            {/* Rx Medicines */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                  Prescribed Medicines
                </h3>
                {!isSigned && (
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="btn btn-ghost btn-sm text-primary-500 hover:text-primary-600 gap-1 p-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                )}
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-2"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      {item.mode === 'SELECT' ? (
                        <select
                          value={item.medicineName}
                          disabled={isSigned}
                          onChange={(e) => {
                            if (e.target.value === '__CUSTOM__') {
                              handleItemChange(idx, 'mode', 'CUSTOM');
                              handleItemChange(idx, 'medicineName', '');
                            } else {
                              handleItemChange(idx, 'medicineName', e.target.value);
                            }
                          }}
                          className="input py-1 px-2 text-xs font-semibold flex-1 bg-[var(--color-surface)] truncate"
                        >
                          <option value="">-- Select Available Stock Medicine --</option>
                          {availableMedicines.map((m) => {
                            const label = `${m.genericName}${m.brandName ? ` (${m.brandName})` : ''} - ${m.strength}`;
                            return (
                              <option key={m.id} value={m.genericName}>
                                💊 {label}
                              </option>
                            );
                          })}
                          <option value="__CUSTOM__">✍️ Custom Medicine (Not in Stock / Free Text)...</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="Type custom medicine name..."
                          value={item.medicineName}
                          onChange={(e) => handleItemChange(idx, 'medicineName', e.target.value)}
                          disabled={isSigned}
                          className="input py-1 px-2 text-xs font-semibold flex-1"
                        />
                      )}

                      {!isSigned && (
                        <button
                          type="button"
                          onClick={() => toggleItemMode(idx)}
                          className="px-2 py-1 text-[10px] font-bold border border-[var(--color-border)] rounded bg-gray-50 hover:bg-gray-100 dark:bg-neutral-800 text-[var(--color-text-secondary)] flex items-center gap-1 shrink-0 transition-all"
                          title={item.mode === 'SELECT' ? 'Switch to Custom Free Text' : 'Switch to Stock Dropdown'}
                        >
                          {item.mode === 'SELECT' ? (
                            <Edit className="w-3 h-3 text-primary-500" />
                          ) : (
                            <List className="w-3 h-3 text-emerald-500" />
                          )}
                          <span>{item.mode === 'SELECT' ? 'Custom' : 'Stock'}</span>
                        </button>
                      )}

                      {!isSigned && items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-danger-500 hover:text-danger-600 p-1 shrink-0"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                      <input
                        type="text"
                        placeholder="Dose"
                        value={item.dose}
                        onChange={(e) => handleItemChange(idx, 'dose', e.target.value)}
                        disabled={isSigned}
                        className="input py-0.5 px-1.5 text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Freq"
                        value={item.frequency}
                        onChange={(e) => handleItemChange(idx, 'frequency', e.target.value)}
                        disabled={isSigned}
                        className="input py-0.5 px-1.5 text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Duration"
                        value={item.duration}
                        onChange={(e) => handleItemChange(idx, 'duration', e.target.value)}
                        disabled={isSigned}
                        className="input py-0.5 px-1.5 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagnostic Lab Orders — real Lab Test Master catalogue */}
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
                <Microscope className="w-4 h-4 text-secondary-500" />
                Diagnostic Lab Orders
              </h3>
              <div className="flex gap-2">
                <select
                  value={labTestPicker}
                  onChange={(e) => setLabTestPicker(e.target.value)}
                  disabled={isSigned}
                  className="input py-1 px-2 text-xs flex-1"
                >
                  <option value="">-- Select from Lab Test Master --</option>
                  {availableLabTests
                    .filter((t) => !selectedLabTestIds.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        🧪 {t.name} ({t.discipline.replace(/_/g, ' ')})
                      </option>
                    ))}
                </select>
                {!isSigned && (
                  <button
                    type="button"
                    onClick={handleAddLabTest}
                    disabled={!labTestPicker}
                    className="btn btn-secondary btn-sm"
                  >
                    Add
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedLabTestIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100"
                  >
                    🧪 {labTestName(id)}
                    {!isSigned && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLabTest(id)}
                        className="hover:text-danger-600 ml-1 font-bold"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {selectedLabTestIds.length === 0 && (
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">
                    Selected tests are ordered together as one Lab Order when the draft is saved.
                  </p>
                )}
              </div>
            </div>

            {/* Lab orders already placed for this visit — real backend state, not local mock data */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                  <Microscope className="w-4 h-4 text-emerald-600" />
                  Lab Orders for This Visit
                </h3>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {existingLabOrders.length} Order(s)
                </span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {labOrdersLoading ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2 text-center">Loading…</p>
                ) : existingLabOrders.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2 text-center">
                    No lab orders placed for this visit yet.
                  </p>
                ) : (
                  existingLabOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[var(--color-text-primary)] font-mono">
                          {order.labNumber ?? 'Pending No.'}
                        </span>
                        <Badge
                          variant={
                            order.status === 'REPORTED'
                              ? 'success'
                              : order.status === 'CANCELLED'
                              ? 'danger'
                              : 'warning'
                          }
                          className="text-[10px] px-1.5 py-0.5"
                        >
                          {order.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[var(--color-text-secondary)]">
                        {order.items.map((i) => i.labTest.name).join(', ')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recommend Therapy — OPD entry point 2, right from the consultation */}
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
                <Activity className="w-4 h-4 text-secondary-500" />
                Recommend Therapy
              </h3>
              <div className="flex gap-2">
                <select
                  value={selectedTherapyServiceId}
                  onChange={(e) => setSelectedTherapyServiceId(e.target.value)}
                  disabled={isSigned}
                  className="input py-1 px-2 text-xs flex-1"
                >
                  <option value="">-- Select from Therapy Catalogue --</option>
                  {availableTherapyServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      💆 {s.name} {s.currentPrice ? `— ₹${s.currentPrice}` : '(unpriced)'} [{s.unit}]
                    </option>
                  ))}
                </select>
              </div>
              {selectedTherapyService?.unit === 'COURSE' && (
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={therapyPlannedSessions}
                  onChange={(e) => setTherapyPlannedSessions(Number(e.target.value))}
                  className="input py-1 px-2 text-xs w-32"
                  placeholder="Planned sessions"
                />
              )}
              {!isSigned && (
                <button
                  type="button"
                  onClick={handleRecommendTherapy}
                  disabled={!selectedTherapyServiceId || recommendingTherapy || !visit}
                  className="btn btn-secondary btn-sm w-full"
                >
                  {recommendingTherapy
                    ? 'Recommending…'
                    : selectedTherapyService?.unit === 'COURSE'
                      ? 'Recommend Course'
                      : 'Recommend Session'}
                </button>
              )}

              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {therapyLoading ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2 text-center">Loading…</p>
                ) : existingTherapySessions.length === 0 && existingTherapyCourses.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2 text-center">
                    No therapy recommended for this visit yet.
                  </p>
                ) : (
                  <>
                    {existingTherapyCourses.map((c) => (
                      <div key={c.id} className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--color-text-primary)]">{c.service.name}</span>
                        <Badge variant={c.status === 'COMPLETED' ? 'success' : 'warning'} className="text-[10px] px-1.5 py-0.5">
                          {c.status}
                        </Badge>
                      </div>
                    ))}
                    {existingTherapySessions
                      .filter((s) => !s.courseId)
                      .map((s) => (
                        <div key={s.id} className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs">
                          <span className="font-semibold text-[var(--color-text-primary)]">{s.service.name}</span>
                          <Badge
                            variant={s.status === 'PERFORMED' ? 'success' : s.status === 'SCHEDULED' ? 'warning' : 'danger'}
                            className="text-[10px] px-1.5 py-0.5"
                          >
                            {s.status}
                          </Badge>
                        </div>
                      ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Sticky Action Bar at Bottom */}
        <div
          className="fixed bottom-0 right-0 left-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 px-6 shadow-lg z-40 flex items-center justify-between"
          style={{ marginLeft: 'var(--current-sidebar-width, 260px)' }}
        >
          <div className="text-xs text-[var(--color-text-secondary)]">
            {activePrescription ? `Draft ID: ${activePrescription.id}` : 'Unsaved consultation draft'}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-secondary btn-md gap-2"
            >
              <Printer className="w-4 h-4" /> Print Consultation
            </button>

            {!isSigned && (
              <button
                type="button"
                onClick={() => handleSaveDraft()}
                disabled={submitting}
                className="btn btn-secondary btn-md gap-2"
              >
                <Save className="w-4 h-4" /> Save Draft
              </button>
            )}
            <button
              type="button"
              onClick={handleSignPrescription}
              disabled={submitting || isSigned || !activePrescription}
              title={!activePrescription && !isSigned ? 'Save the prescription draft first' : undefined}
              className="btn btn-primary btn-md gap-2"
            >
              <Lock className="w-4 h-4" />
              {isSigned ? 'Digitally Signed & Locked' : 'Sign & Submit Prescription'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
