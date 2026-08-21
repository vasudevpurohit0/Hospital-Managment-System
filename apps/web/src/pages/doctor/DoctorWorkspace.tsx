import React, { useState, useEffect, useCallback } from 'react';
import {
  createPrescription,
  signPrescription,
  PrescriptionItemPayload,
  PrescriptionRecord,
} from '../../api/prescription.api';
import { evaluateBenefitRule } from '../../api/benefit.api';
import { fetchVisitById, VisitDetail } from '../../api/patient-lookup.api';
import { fetchMedicines, MedicineRecord } from '../../api/inventory.api';
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
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';

interface DoctorWorkspaceProps {
  authToken: string;
}

interface RxItemState extends PrescriptionItemPayload {
  mode: 'SELECT' | 'CUSTOM';
}

export interface LabResultRecord {
  id: string;
  testName: string;
  resultValue: string;
  unit: string;
  status: 'NORMAL' | 'ABNORMAL' | 'PENDING' | 'COMPLETED';
  notes: string;
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

  const [labTests, setLabTests] = useState<string[]>([]);
  const [newLabTest, setNewLabTest] = useState('');

  /* Diagnosis Lab Results State */
  const [labResults, setLabResults] = useState<LabResultRecord[]>([]);
  const [resultTestName, setResultTestName] = useState('');
  const [resultValue, setResultValue] = useState('');
  const [resultUnit, setResultUnit] = useState('');
  const [resultStatus, setResultStatus] = useState<'NORMAL' | 'ABNORMAL' | 'PENDING' | 'COMPLETED'>('NORMAL');
  const [resultNotes, setResultNotes] = useState('');

  const [activePrescription, setActivePrescription] = useState<PrescriptionRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authToken) {
      fetchMedicines(authToken)
        .then((meds) => setAvailableMedicines(meds))
        .catch((err) => console.error('Failed to load medicines catalog', err));
    }
  }, [authToken]);

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
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!visitIdInput.trim()) return;

      setVisitLoading(true);
      setVisitError(null);
      setVisit(null);
      setActivePrescription(null);

      try {
        const res = await fetchVisitById(visitIdInput.trim(), authToken);
        setVisit(res);
      } catch (err: unknown) {
        setVisitError(err instanceof Error ? err.message : 'Failed to load visit');
      } finally {
        setVisitLoading(false);
      }
    },
    [visitIdInput, authToken],
  );

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
    if (!newLabTest.trim()) return;
    const testName = newLabTest.trim();
    setLabTests([...labTests, testName]);

    // Also auto-populate a pending result entry for convenience
    if (!labResults.some((r) => r.testName.toLowerCase() === testName.toLowerCase())) {
      setLabResults((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          testName,
          resultValue: 'Pending',
          unit: '-',
          status: 'PENDING',
          notes: 'Order initiated',
        },
      ]);
    }

    setNewLabTest('');
  };

  const handleRemoveLabTest = (index: number) => {
    setLabTests(labTests.filter((_, i) => i !== index));
  };

  const handleAddLabResult = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!resultTestName.trim()) return;

    const newResult: LabResultRecord = {
      id: Date.now().toString(),
      testName: resultTestName.trim(),
      resultValue: resultValue.trim() || 'N/A',
      unit: resultUnit.trim(),
      status: resultStatus,
      notes: resultNotes.trim(),
    };

    setLabResults([...labResults, newResult]);
    setResultTestName('');
    setResultValue('');
    setResultNotes('');
  };

  const handleRemoveLabResult = (id: string) => {
    setLabResults(labResults.filter((r) => r.id !== id));
  };

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

    if (validItems.length === 0) {
      setError('Please select or type at least one prescribed medicine name.');
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
          labTests,
        },
        authToken,
      );

      setActivePrescription(res.prescription);
      setSuccessMessage('Prescription draft saved in DRAFT state.');
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
              ESIC MODEL HOSPITAL & ODC
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

        {/* Diagnosis Lab Results */}
        <div className="mb-4 text-xs">
          <h3 className="font-bold text-sm border-b border-gray-400 pb-1 mb-2 uppercase">
            Diagnostic Lab Orders & Diagnosis Lab Results
          </h3>
          {labResults.length > 0 ? (
            <table className="w-full border-collapse border border-gray-400 text-left text-xs mb-2">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-400 p-1.5">Test Name</th>
                  <th className="border border-gray-400 p-1.5">Result / Value</th>
                  <th className="border border-gray-400 p-1.5">Unit</th>
                  <th className="border border-gray-400 p-1.5">Status</th>
                  <th className="border border-gray-400 p-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {labResults.map((res) => (
                  <tr key={res.id}>
                    <td className="border border-gray-400 p-1.5 font-semibold">{res.testName}</td>
                    <td className="border border-gray-400 p-1.5 font-mono">{res.resultValue}</td>
                    <td className="border border-gray-400 p-1.5">{res.unit}</td>
                    <td className="border border-gray-400 p-1.5 font-bold">{res.status}</td>
                    <td className="border border-gray-400 p-1.5">{res.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600">No laboratory results recorded for this visit.</p>
          )}

          {labTests.length > 0 && (
            <p className="mt-1">
              <strong>Ordered Tests:</strong> {labTests.join(', ')}
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

            {/* Diagnostic Lab Orders */}
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-secondary-500" />
                Diagnostic Lab Orders
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Order lab test..."
                  value={newLabTest}
                  onChange={(e) => setNewLabTest(e.target.value)}
                  disabled={isSigned}
                  className="input py-1 px-2 text-xs"
                />
                {!isSigned && (
                  <button
                    type="button"
                    onClick={handleAddLabTest}
                    className="btn btn-secondary btn-sm"
                  >
                    Add Order
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {labTests.map((test, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100"
                  >
                    🧪 {test}
                    {!isSigned && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLabTest(i)}
                        className="hover:text-danger-600 ml-1 font-bold"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Diagnosis Lab Results */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-emerald-600" />
                  Diagnosis Lab Results
                </h3>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {labResults.length} Results Recorded
                </span>
              </div>

              {!isSigned && (
                <form onSubmit={handleAddLabResult} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 space-y-2">
                  <p className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                    Record New Lab Result
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <input
                      type="text"
                      placeholder="Test Name (e.g. Hb, FBS)..."
                      value={resultTestName}
                      onChange={(e) => setResultTestName(e.target.value)}
                      className="input py-1 px-2 text-xs col-span-2"
                    />
                    <input
                      type="text"
                      placeholder="Result Value (e.g. 13.5)"
                      value={resultValue}
                      onChange={(e) => setResultValue(e.target.value)}
                      className="input py-1 px-2 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Unit (e.g. g/dL)"
                      value={resultUnit}
                      onChange={(e) => setResultUnit(e.target.value)}
                      className="input py-1 px-2 text-xs"
                    />
                    <select
                      value={resultStatus}
                      onChange={(e) => setResultStatus(e.target.value as any)}
                      className="input py-1 px-2 text-xs font-semibold"
                    >
                      <option value="NORMAL">✅ Normal</option>
                      <option value="ABNORMAL">⚠️ Abnormal</option>
                      <option value="PENDING">⏳ Pending</option>
                      <option value="COMPLETED">✔️ Completed</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Notes / Normal Range..."
                      value={resultNotes}
                      onChange={(e) => setResultNotes(e.target.value)}
                      className="input py-1 px-2 text-xs col-span-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!resultTestName.trim()}
                    className="btn btn-secondary btn-sm w-full gap-1 mt-1 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" /> Save Lab Result
                  </button>
                </form>
              )}

              {/* Lab Results Display List */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {labResults.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2 text-center">
                    No lab test results recorded yet.
                  </p>
                ) : (
                  labResults.map((res) => (
                    <div
                      key={res.id}
                      className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[var(--color-text-primary)]">
                          {res.testName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              res.status === 'NORMAL' || res.status === 'COMPLETED'
                                ? 'success'
                                : res.status === 'ABNORMAL'
                                ? 'danger'
                                : 'warning'
                            }
                            className="text-[10px] px-1.5 py-0.5"
                          >
                            {res.status}
                          </Badge>
                          {!isSigned && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLabResult(res.id)}
                              className="text-danger-500 hover:text-danger-600 p-0.5"
                              title="Delete result"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="font-bold text-primary-600">
                          {res.resultValue} {res.unit}
                        </span>
                        {res.notes && (
                          <span className="text-[var(--color-text-secondary)] italic font-sans text-[10px] truncate max-w-[140px]">
                            {res.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
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
              disabled={submitting || isSigned}
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
