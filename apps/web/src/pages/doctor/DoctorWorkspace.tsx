import React, { useState, useEffect } from 'react';
import {
  createPrescription,
  signPrescription,
  PrescriptionItemPayload,
  PrescriptionRecord,
} from '../../api/prescription.api';
import { evaluateBenefitRule } from '../../api/benefit.api';
import { User, AlertTriangle, Stethoscope, Plus, Trash2, Lock, Save, FileText } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';

interface DoctorWorkspaceProps {
  authToken: string;
}

export const DoctorWorkspace: React.FC<DoctorWorkspaceProps> = ({ authToken }) => {
  const [visitIdInput, setVisitIdInput] = useState('v-1001');
  const [employmentType, setEmploymentType] = useState<'PERMANENT' | 'CONTRACTUAL'>('PERMANENT');
  const [benefitOutcome, setBenefitOutcome] = useState<'FREE' | 'COVERED' | 'PAID'>('COVERED');

  const [symptoms, setSymptoms] = useState('Fever, dry cough, body pain for 3 days');
  const [examinationNotes, setExaminationNotes] = useState('Temp: 101°F, BP: 120/80, Chest clear');
  const [diagnosisText, setDiagnosisText] = useState('Acute Upper Respiratory Tract Infection');
  const [followUpFlag, setFollowUpFlag] = useState(true);
  const [admissionRecommended, setAdmissionRecommended] = useState(false);

  const [items, setItems] = useState<PrescriptionItemPayload[]>([
    {
      medicineName: 'Paracetamol 500mg',
      dose: '1 Tablet',
      frequency: '1-0-1 (Twice Daily)',
      duration: '5 Days',
    },
    {
      medicineName: 'Azithromycin 500mg',
      dose: '1 Tablet',
      frequency: '1-0-0 (Once Daily)',
      duration: '3 Days',
    },
  ]);

  const [labTests, setLabTests] = useState<string[]>([
    'Complete Blood Count (CBC)',
    'Serum Creatinine',
  ]);
  const [newLabTest, setNewLabTest] = useState('');

  const [activePrescription, setActivePrescription] = useState<PrescriptionRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    evaluateBenefitRule(employmentType, undefined, authToken)
      .then((res) => setBenefitOutcome(res.outcome))
      .catch(() => {
        setBenefitOutcome(employmentType === 'CONTRACTUAL' ? 'PAID' : 'COVERED');
      });
  }, [employmentType, authToken]);

  const handleAddItem = () => {
    setItems([
      ...items,
      { medicineName: '', dose: '1 Tablet', frequency: '1-0-1', duration: '5 Days' },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof PrescriptionItemPayload, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleAddLabTest = () => {
    if (!newLabTest.trim()) return;
    setLabTests([...labTests, newLabTest.trim()]);
    setNewLabTest('');
  };

  const handleRemoveLabTest = (index: number) => {
    setLabTests(labTests.filter((_, i) => i !== index));
  };

  const handleSaveDraft = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const res = await createPrescription(
        {
          visitId: visitIdInput,
          symptoms,
          examinationNotes,
          diagnosisText,
          followUpFlag,
          admissionRecommended,
          items,
          labTests,
        },
        authToken,
      );

      setActivePrescription(res.prescription);
      setSuccessMessage('Prescription draft saved in DRAFT state.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save draft prescription');
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

  const isSigned = activePrescription?.status === 'SIGNED';

  return (
    <div className="space-y-6 animate-fade-in pb-20">
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

        <div>
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
            <div className="flex items-center gap-3 pb-3 border-b border-[var(--color-border)]">
              <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600">
                <User className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[var(--color-text-primary)]">Rahul Kumar</h3>
                <p className="text-xs text-[var(--color-text-secondary)]">M / 42 yrs • B+</p>
                <p className="text-[10px] text-primary-600 font-mono font-semibold">
                  UHID: ESIC-MH-001042
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Visit Context ID
              </label>
              <input
                type="text"
                value={visitIdInput}
                onChange={(e) => setVisitIdInput(e.target.value)}
                disabled={isSigned}
                className="input text-xs font-mono py-1.5"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                ESIC Benefit Rule Engine
              </label>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as 'PERMANENT' | 'CONTRACTUAL')}
                disabled={isSigned}
                className="input text-xs py-1.5 font-medium"
              >
                <option value="PERMANENT">PERMANENT (ESIC Covered)</option>
                <option value="CONTRACTUAL">CONTRACTUAL (Self Paid)</option>
              </select>
              <div className="pt-1">
                <Badge variant={benefitOutcome === 'PAID' ? 'warning' : 'success'}>
                  {benefitOutcome === 'PAID' ? 'Self Paid' : 'ESIC 100% Covered'}
                </Badge>
              </div>
            </div>

            {/* Vitals Summary */}
            <div className="pt-3 border-t border-[var(--color-border)] space-y-2">
              <p className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Patient Vitals
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[var(--color-surface-secondary)] p-2 rounded-lg">
                  <span className="text-[10px] text-[var(--color-text-tertiary)] block">BP</span>
                  <span className="font-semibold">120/80 mmHg</span>
                </div>
                <div className="bg-[var(--color-surface-secondary)] p-2 rounded-lg">
                  <span className="text-[10px] text-[var(--color-text-tertiary)] block">Temp</span>
                  <span className="font-semibold text-danger-600">101 °F</span>
                </div>
                <div className="bg-[var(--color-surface-secondary)] p-2 rounded-lg">
                  <span className="text-[10px] text-[var(--color-text-tertiary)] block">Pulse</span>
                  <span className="font-semibold">88 bpm</span>
                </div>
                <div className="bg-[var(--color-surface-secondary)] p-2 rounded-lg">
                  <span className="text-[10px] text-[var(--color-text-tertiary)] block">SpO2</span>
                  <span className="font-semibold">98 %</span>
                </div>
              </div>
            </div>

            {/* Allergies Warning */}
            <div className="p-2.5 rounded-lg bg-danger-50 text-danger-600 border border-danger-100 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Allergy: Penicillin / Amoxicillin</span>
            </div>
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

        {/* Right Panel: Digital Rx & Lab Orders (4 cols) */}
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

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      placeholder="Medicine name"
                      value={item.medicineName}
                      onChange={(e) => handleItemChange(idx, 'medicineName', e.target.value)}
                      disabled={isSigned}
                      className="input py-1 px-2 text-xs font-semibold"
                    />
                    {!isSigned && items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-danger-500 hover:text-danger-600 p-1"
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
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-2">
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
                  Add
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {labTests.map((test, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100"
                >
                  {test}
                  {!isSigned && (
                    <button
                      type="button"
                      onClick={() => handleRemoveLabTest(i)}
                      className="hover:text-danger-600"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
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
  );
};
