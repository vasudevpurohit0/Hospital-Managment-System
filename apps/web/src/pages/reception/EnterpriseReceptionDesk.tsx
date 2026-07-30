import React, { useState, useEffect } from 'react';
import { Badge } from '../../components/ui/Badge';
import {
  UserPlus,
  Search,
  AlertTriangle,
  Clock,
  Printer,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Activity,
  Zap,
  Users,
  Bell,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   Enterprise Reception Desk Workspace (Production Grade)
   Modeled after Epic EMR, Cerner, Oracle Health, Bahmni & Apollo HMS
   ═══════════════════════════════════════════════════════════ */

interface EnterpriseReceptionDeskProps {
  authToken: string;
  initialWorkflow?: ActiveWorkflow;
}

type ActiveWorkflow =
  | 'dashboard'
  | 'esic-beneficiary'
  | 'walkin-registration'
  | 'universal-search'
  | 'emergency-registration'
  | 'appointments'
  | 'success-slip';

interface Dependent {
  id: string;
  relation: string;
  name: string;
  age: number;
  gender: string;
  eligibility: 'ELIGIBLE' | 'EXPIRED';
  registered: boolean;
  uhid?: string;
}

export const EnterpriseReceptionDesk: React.FC<EnterpriseReceptionDeskProps> = ({
  initialWorkflow = 'dashboard',
}) => {
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow>(initialWorkflow);

  useEffect(() => {
    if (initialWorkflow) {
      setActiveWorkflow(initialWorkflow);
    }
  }, [initialWorkflow]);

  // Universal Search State
  const [searchQuery, setSearchQuery] = useState('ESIC-MH-001042');

  // ESIC Verification State
  const [esicIpInput, setEsicIpInput] = useState('1234567890');
  const [verifyingEsic, setVerifyingEsic] = useState(false);
  const [verifiedEmployee, setVerifiedEmployee] = useState<Record<string, unknown> | null>(null);
  const [dependents, setDependents] = useState<Dependent[]>([]);

  // Walk-in Registration State
  const [walkinData, setWalkinData] = useState({
    fullName: '',
    dob: '1992-06-15',
    gender: 'MALE',
    bloodGroup: 'O+',
    mobile: '',
    address: '',
    emergencyContact: '',
    insuranceType: 'ESIC Covered (100%)',
    department: 'General Medicine',
    doctorPreference: 'Dr. S. Sharma',
    chiefComplaint: 'Fever, cough, body pain',
  });

  // Success Registration Result
  const [registrationResult, setRegistrationResult] = useState<{
    uhid: string;
    visitId: string;
    tokenNumber: string;
    patientName: string;
    dept: string;
    doctor: string;
    waitTime: string;
    issuedAt: string;
  } | null>(null);

  // Active Patient Selected for Right-Panel Preview
  const [activePatientPreview, setActivePatientPreview] = useState({
    name: 'Rahul Kumar',
    uhid: 'ESIC-MH-001042',
    ipNo: '1234567890',
    age: 42,
    gender: 'Male',
    bloodGroup: 'B+',
    insurance: 'ESIC 100% Covered',
    status: 'Waiting in OPD Queue',
    token: 'T-0045',
    dept: 'General Medicine',
    doctor: 'Dr. S. Sharma',
    allergies: ['Penicillin', 'Amoxicillin'],
    alerts: ['High Fever (101°F)', 'Chronic URTI'],
    lastVisit: '20 Jul 2026',
    outstandingBills: '₹0.00 (Covered)',
  });

  // Live Queue Data
  const [liveQueue] = useState([
    {
      id: '1',
      token: 'T-0043',
      name: 'Suresh Patel',
      status: 'IN_CONSULTATION',
      doctor: 'Dr. S. Sharma',
    },
    { id: '2', token: 'T-0044', name: 'Priya Devi', status: 'CALLED', doctor: 'Dr. S. Sharma' },
    { id: '3', token: 'T-0045', name: 'Rahul Kumar', status: 'WAITING', doctor: 'Dr. S. Sharma' },
    { id: '4', token: 'T-0046', name: 'Anita Singh', status: 'WAITING', doctor: 'Dr. A. Verma' },
    {
      id: '5',
      token: 'EMG-01',
      name: 'Rajesh Kumar (Emergency)',
      status: 'EMERGENCY',
      doctor: 'Dr. K. Rao',
    },
  ]);

  // Global Keyboard Shortcuts (Ctrl+N, Ctrl+F, Ctrl+P, Ctrl+Q)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveWorkflow('walkin-registration');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveWorkflow('universal-search');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setActiveWorkflow('dashboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ESIC Verification Handler
  const handleVerifyEsic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!esicIpInput.trim()) return;

    setVerifyingEsic(true);
    setTimeout(() => {
      const emp = {
        name: 'Rahul Kumar',
        ipNo: esicIpInput.trim(),
        employer: 'Tata Consultancy Services - ESIC Delhi',
        designation: 'Senior Specialist',
        benefitCategory: 'PERMANENT (Full Benefit Covered)',
      };
      const deps: Dependent[] = [
        {
          id: 'dep-1',
          relation: 'Self',
          name: 'Rahul Kumar',
          age: 42,
          gender: 'Male',
          eligibility: 'ELIGIBLE',
          registered: true,
          uhid: 'ESIC-MH-001042',
        },
        {
          id: 'dep-2',
          relation: 'Spouse',
          name: 'Sunita Devi',
          age: 38,
          gender: 'Female',
          eligibility: 'ELIGIBLE',
          registered: true,
          uhid: 'ESIC-MH-001043',
        },
        {
          id: 'dep-3',
          relation: 'Son',
          name: 'Aarav Kumar',
          age: 12,
          gender: 'Male',
          eligibility: 'ELIGIBLE',
          registered: false,
        },
        {
          id: 'dep-4',
          relation: 'Daughter',
          name: 'Ananya Kumar',
          age: 8,
          gender: 'Female',
          eligibility: 'ELIGIBLE',
          registered: false,
        },
        {
          id: 'dep-5',
          relation: 'Mother',
          name: 'Kausalya Devi',
          age: 68,
          gender: 'Female',
          eligibility: 'ELIGIBLE',
          registered: false,
        },
      ];

      setVerifiedEmployee(emp);
      setDependents(deps);
      setVerifyingEsic(false);
    }, 600);
  };

  // Complete Dependent Registration & Create Visit
  const handleSelectDependent = (dep: Dependent) => {
    const generatedUhid = dep.uhid || `ESIC-MH-00${Math.floor(1000 + Math.random() * 9000)}`;
    const result = {
      uhid: generatedUhid,
      visitId: `v-${Math.floor(1000 + Math.random() * 9000)}`,
      tokenNumber: `T-00${Math.floor(40 + Math.random() * 20)}`,
      patientName: dep.name,
      dept: 'General Medicine',
      doctor: 'Dr. S. Sharma',
      waitTime: '12 mins',
      issuedAt: new Date().toISOString(),
    };
    setRegistrationResult(result);
    setActivePatientPreview({
      name: dep.name,
      uhid: generatedUhid,
      ipNo: esicIpInput,
      age: dep.age,
      gender: dep.gender,
      bloodGroup: 'B+',
      insurance: 'ESIC 100% Covered',
      status: 'Queue Token Issued',
      token: result.tokenNumber,
      dept: 'General Medicine',
      doctor: 'Dr. S. Sharma',
      allergies: ['Penicillin'],
      alerts: ['ESIC Beneficiary Verified'],
      lastVisit: 'Today',
      outstandingBills: '₹0.00 (Covered)',
    });
    setActiveWorkflow('success-slip');
  };

  // Emergency Fast Registration
  const handleEmergencyRegistration = () => {
    const tempUhid = `TEMP-EMG-${Math.floor(1000 + Math.random() * 9000)}`;
    const result = {
      uhid: tempUhid,
      visitId: `v-emg-${Math.floor(100 + Math.random() * 900)}`,
      tokenNumber: 'EMG-02',
      patientName: 'Emergency Patient (Temporary Record)',
      dept: 'Emergency Trauma Unit',
      doctor: 'Dr. Emergency On-Duty',
      waitTime: 'IMMEDIATE / ZERO WAIT',
      issuedAt: new Date().toISOString(),
    };
    setRegistrationResult(result);
    setActivePatientPreview({
      name: 'Emergency Patient (Temp)',
      uhid: tempUhid,
      ipNo: 'UNVERIFIED (Emergency)',
      age: 30,
      gender: 'Male',
      bloodGroup: 'O-',
      insurance: 'Emergency Override',
      status: 'Direct Trauma Admission',
      token: 'EMG-02',
      dept: 'Emergency Trauma Unit',
      doctor: 'Dr. Emergency On-Duty',
      allergies: ['UNKNOWN'],
      alerts: ['CRITICAL EMERGENCY OVERRIDE'],
      lastVisit: 'None',
      outstandingBills: 'Deferred',
    });
    setActiveWorkflow('success-slip');
  };

  // Walk-in Form Submit
  const handleWalkinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const generatedUhid = `ESIC-MH-00${Math.floor(1000 + Math.random() * 9000)}`;
    const result = {
      uhid: generatedUhid,
      visitId: `v-${Math.floor(1000 + Math.random() * 9000)}`,
      tokenNumber: `T-00${Math.floor(50 + Math.random() * 20)}`,
      patientName: walkinData.fullName || 'Walk-in Patient',
      dept: walkinData.department,
      doctor: walkinData.doctorPreference,
      waitTime: '15 mins',
      issuedAt: new Date().toISOString(),
    };
    setRegistrationResult(result);
    setActivePatientPreview({
      name: walkinData.fullName || 'Walk-in Patient',
      uhid: generatedUhid,
      ipNo: 'Walk-in / General',
      age: 30,
      gender: walkinData.gender,
      bloodGroup: walkinData.bloodGroup,
      insurance: walkinData.insuranceType,
      status: 'Queue Token Issued',
      token: result.tokenNumber,
      dept: walkinData.department,
      doctor: walkinData.doctorPreference,
      allergies: [],
      alerts: ['Walk-in Registration Completed'],
      lastVisit: 'Today (First Visit)',
      outstandingBills: '₹0.00',
    });
    setActiveWorkflow('success-slip');
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── Top Operational Reception KPI Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Patients Waiting', val: '14', color: 'text-warning-600', icon: Clock },
          { label: "Today's Registrations", val: '38', color: 'text-primary-600', icon: UserPlus },
          { label: "Today's Appointments", val: '22', color: 'text-secondary-600', icon: Calendar },
          { label: 'Walk-in Patients', val: '16', color: 'text-info-600', icon: Users },
          { label: 'Avg Wait Time', val: '12 mins', color: 'text-success-600', icon: Activity },
          { label: 'Emergency Patients', val: '2 Active', color: 'text-danger-600', icon: Zap },
        ].map((kpi, idx) => (
          <div key={idx} className="card p-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-secondary)]">
                {kpi.label}
              </p>
              <h3 className={`text-lg font-bold ${kpi.color} mt-0.5`}>{kpi.val}</h3>
            </div>
            <kpi.icon className="w-5 h-5 text-[var(--color-text-tertiary)] opacity-50" />
          </div>
        ))}
      </div>

      {/* ── Main 3-Column Enterprise Workspace ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ── LEFT COLUMN: Quick Actions & Notices (3 cols) ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Quick Action Buttons */}
          <div className="card p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              Front-Office Actions
            </h3>

            <button
              onClick={() => setActiveWorkflow('esic-beneficiary')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'esic-beneficiary' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-secondary-500" />
              <span>ESIC Beneficiary Registration</span>
            </button>

            <button
              onClick={() => setActiveWorkflow('walkin-registration')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'walkin-registration' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <UserPlus className="w-4 h-4 text-primary-500" />
              <span>Walk-in Patient Form (Ctrl+N)</span>
            </button>

            <button
              onClick={() => setActiveWorkflow('universal-search')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'universal-search' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <Search className="w-4 h-4 text-info-500" />
              <span>Universal Patient Search (Ctrl+F)</span>
            </button>

            <button
              onClick={handleEmergencyRegistration}
              className="w-full btn btn-danger btn-md justify-start gap-2.5 bg-danger-600 hover:bg-danger-700 text-white"
            >
              <Zap className="w-4 h-4" />
              <span>Emergency 1-Click Override</span>
            </button>

            <button
              onClick={() => setActiveWorkflow('dashboard')}
              className={`w-full btn btn-md justify-start gap-2.5 ${
                activeWorkflow === 'dashboard' ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Reception Live Queue (Ctrl+Q)</span>
            </button>
          </div>

          {/* Hospital Notices & Alerts */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-warning-500" /> Hospital Announcements
            </h3>
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-lg bg-warning-50 text-warning-800 border border-warning-100">
                <span className="font-semibold block">Dr. A. Verma (Pediatrics)</span>
                <span className="text-[11px]">On leave today. Route to Dr. Sharma.</span>
              </div>
              <div className="p-2.5 rounded-lg bg-primary-50 text-primary-800 border border-primary-100">
                <span className="font-semibold block">OPD Room #4 Maintenance</span>
                <span className="text-[11px]">Token calls shifted to Room #6.</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── CENTER COLUMN: Operational Workflow Manager (6 cols) ── */}
        <div className="lg:col-span-6 space-y-5">
          {/* WORKFLOW 1: Operational Reception Dashboard */}
          {activeWorkflow === 'dashboard' && (
            <div className="card p-5 space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <div>
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Reception Operational Queue Console
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Real-time OPD token flow & doctor availability status
                  </p>
                </div>
                <Badge variant="success" dot>
                  Live Operations
                </Badge>
              </div>

              {/* Active Doctors Status */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Active Attending Doctors
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: 'Dr. S. Sharma', dept: 'General Med', queue: 5, status: 'AVAILABLE' },
                    { name: 'Dr. P. Joshi', dept: 'Orthopedics', queue: 8, status: 'BUSY' },
                    { name: 'Dr. K. Rao', dept: 'Cardiology', queue: 2, status: 'AVAILABLE' },
                    { name: 'Dr. M. Gupta', dept: 'Pediatrics', queue: 4, status: 'BUSY' },
                  ].map((doc, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[var(--color-text-primary)]">
                          {doc.name}
                        </span>
                        <Badge variant={doc.status === 'AVAILABLE' ? 'success' : 'warning'}>
                          {doc.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[var(--color-text-secondary)]">
                        {doc.dept} • Queue: {doc.queue} Patients
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* WORKFLOW 2: ESIC Beneficiary Selection & Verification */}
          {activeWorkflow === 'esic-beneficiary' && (
            <div className="card p-5 space-y-5">
              <div className="border-b border-[var(--color-border)] pb-3">
                <Badge variant="info" className="mb-1">
                  ESIC Beneficiary Portal
                </Badge>
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  ESIC Insurance IP Verification & Dependent Selector
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Enter Insurance IP number or scan smart card to view employee & dependents
                </p>
              </div>

              <form onSubmit={handleVerifyEsic} className="flex gap-2">
                <input
                  type="text"
                  value={esicIpInput}
                  onChange={(e) => setEsicIpInput(e.target.value)}
                  placeholder="Enter 10-digit ESIC IP Number (e.g. 1234567890)..."
                  className="input font-mono flex-1 text-xs py-2"
                />
                <button type="submit" disabled={verifyingEsic} className="btn btn-primary btn-md">
                  {verifyingEsic ? 'Verifying...' : 'Verify IP'}
                </button>
              </form>

              {/* Dependents Cards Grid */}
              {verifiedEmployee && (
                <div className="space-y-3 pt-2">
                  <div className="p-3 rounded-xl bg-primary-50 text-primary-900 border border-primary-200 text-xs">
                    <span className="font-bold block text-sm">
                      Insured Employee: {verifiedEmployee.name as string}
                    </span>
                    <span className="text-[11px] font-mono">
                      IP: {verifiedEmployee.ipNo as string} • Employer:{' '}
                      {verifiedEmployee.employer as string}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Family Dependents (Select Patient to Issue Visit)
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {dependents.map((dep) => (
                      <div
                        key={dep.id}
                        onClick={() => handleSelectDependent(dep)}
                        className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:border-primary-500 hover:bg-primary-50/50 cursor-pointer transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-[var(--color-text-primary)]">
                            {dep.name}
                          </span>
                          <Badge variant={dep.registered ? 'success' : 'warning'}>
                            {dep.registered ? 'Registered' : 'First Visit'}
                          </Badge>
                        </div>

                        <div className="text-[11px] text-[var(--color-text-secondary)] space-y-0.5">
                          <p>
                            Relation:{' '}
                            <span className="font-semibold text-primary-600">{dep.relation}</span> •
                            Age: {dep.age} yrs • {dep.gender}
                          </p>
                          {dep.uhid && (
                            <p className="font-mono text-[10px] text-primary-700">
                              UHID: {dep.uhid}
                            </p>
                          )}
                        </div>

                        <div className="pt-1 flex items-center justify-between text-[11px] font-semibold text-primary-600">
                          <span>
                            {dep.registered
                              ? 'Open Profile & Create Visit'
                              : 'Generate UHID & Create Visit'}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WORKFLOW 3: Comprehensive Walk-in Registration Form */}
          {activeWorkflow === 'walkin-registration' && (
            <form onSubmit={handleWalkinSubmit} className="card p-5 space-y-4">
              <div className="border-b border-[var(--color-border)] pb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Direct Walk-in Patient Registration
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    1-Screen registration form for non-employee or walk-in patients
                  </p>
                </div>
                <Badge variant="info">Walk-in Form</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--color-text-secondary)]">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={walkinData.fullName}
                    onChange={(e) => setWalkinData({ ...walkinData, fullName: e.target.value })}
                    placeholder="Patient full name"
                    className="input text-xs py-1.5"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="font-semibold text-[var(--color-text-secondary)]">
                      Gender *
                    </label>
                    <select
                      value={walkinData.gender}
                      onChange={(e) => setWalkinData({ ...walkinData, gender: e.target.value })}
                      className="input text-xs py-1.5"
                    >
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-[var(--color-text-secondary)]">
                      Blood Group
                    </label>
                    <select
                      value={walkinData.bloodGroup}
                      onChange={(e) => setWalkinData({ ...walkinData, bloodGroup: e.target.value })}
                      className="input text-xs py-1.5 font-bold"
                    >
                      <option value="A+">A+</option>
                      <option value="B+">B+</option>
                      <option value="O+">O+</option>
                      <option value="AB+">AB+</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[var(--color-text-secondary)]">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={walkinData.mobile}
                    onChange={(e) => setWalkinData({ ...walkinData, mobile: e.target.value })}
                    placeholder="+91 98765 43210"
                    className="input text-xs font-mono py-1.5"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[var(--color-text-secondary)]">
                    Department Specialty
                  </label>
                  <select
                    value={walkinData.department}
                    onChange={(e) => setWalkinData({ ...walkinData, department: e.target.value })}
                    className="input text-xs py-1.5 font-semibold"
                  >
                    <option value="General Medicine">General Medicine</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="Cardiology">Cardiology</option>
                  </select>
                </div>

                <div className="space-y-1 col-span-2">
                  <label className="font-semibold text-[var(--color-text-secondary)]">
                    Chief Medical Complaint
                  </label>
                  <input
                    type="text"
                    value={walkinData.chiefComplaint}
                    onChange={(e) =>
                      setWalkinData({ ...walkinData, chiefComplaint: e.target.value })
                    }
                    placeholder="Symptoms e.g. Fever, cough, injury..."
                    className="input text-xs py-1.5"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button type="submit" className="btn btn-primary btn-md gap-2 px-6">
                  <Sparkles className="w-4 h-4" /> Generate UHID & Issue Token
                </button>
              </div>
            </form>
          )}

          {/* WORKFLOW 4: Universal Patient Search */}
          {activeWorkflow === 'universal-search' && (
            <div className="card p-5 space-y-4">
              <div className="border-b border-[var(--color-border)] pb-3">
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  Universal Patient Search (8 Attributes)
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Search by UHID, ESIC IP, Aadhaar, Mobile, Name, QR code, Barcode, or Token
                </p>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter UHID / IP No / Aadhaar / Mobile / Name / Token..."
                  className="input input-with-icon text-xs py-2.5 font-mono"
                />
              </div>

              {/* Found Patient Result Card */}
              <div className="p-4 rounded-xl border border-primary-200 bg-primary-50/40 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-[var(--color-text-primary)]">
                      Rahul Kumar
                    </h4>
                    <p className="text-xs font-mono text-primary-700">
                      UHID: ESIC-MH-001042 • IP: 1234567890
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Male • 42 yrs • Blood: B+ • Phone: +91 98765 43210
                    </p>
                  </div>
                  <Badge variant="success">ESIC Covered</Badge>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-primary-100">
                  <button
                    onClick={() => setActiveWorkflow('esic-beneficiary')}
                    className="btn btn-primary btn-sm text-xs gap-1"
                  >
                    Create Visit
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="btn btn-secondary btn-sm text-xs gap-1"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print UHID Card
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* WORKFLOW 5: Registration Success View (Print Slip & Card) */}
          {activeWorkflow === 'success-slip' && registrationResult && (
            <div className="card p-6 space-y-6 animate-fade-in">
              <div className="alert alert-success flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success-600" />
                  <div>
                    <span className="font-bold text-sm block">
                      Registration & OPD Token Issued Successfully!
                    </span>
                    <span className="text-xs">
                      UHID: {registrationResult.uhid} • Token: {registrationResult.tokenNumber}
                    </span>
                  </div>
                </div>
                <button onClick={() => window.print()} className="btn btn-secondary btn-sm gap-1.5">
                  <Printer className="w-4 h-4" /> Print Registration Slip
                </button>
              </div>

              {/* Printable Registration Slip Preview */}
              <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-[var(--color-text-primary)]">
                      ESIC MODEL HOSPITAL — REGISTRATION SLIP
                    </h3>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">
                      Ministry of Labour & Employment, Govt. of India
                    </p>
                  </div>
                  <Badge variant="info" className="font-mono text-xs">
                    {registrationResult.tokenNumber}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Patient Name:</span>{' '}
                    <span className="font-bold text-sm">{registrationResult.patientName}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Hospital UHID:</span>{' '}
                    <span className="font-mono font-bold text-sm text-primary-600">
                      {registrationResult.uhid}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Department:</span>{' '}
                    <span className="font-semibold">{registrationResult.dept}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">
                      Attending Doctor:
                    </span>{' '}
                    <span className="font-semibold">{registrationResult.doctor}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">Visit ID:</span>{' '}
                    <span className="font-mono">{registrationResult.visitId}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)] block">
                      Estimated Wait:
                    </span>{' '}
                    <span className="font-semibold text-warning-600">
                      {registrationResult.waitTime}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setActiveWorkflow('esic-beneficiary')}
                  className="btn btn-secondary btn-md"
                >
                  Register Another Patient
                </button>
                <button
                  onClick={() => setActiveWorkflow('dashboard')}
                  className="btn btn-primary btn-md"
                >
                  Return to Reception Console
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Patient Context Preview & Live Queue (3 cols) ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Patient Context Preview Card */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border)] pb-2 flex items-center justify-between">
              <span>Patient Profile Preview</span>
              <Badge variant="neutral">360° View</Badge>
            </h3>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600 text-sm">
                {activePatientPreview.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-[var(--color-text-primary)] truncate">
                  {activePatientPreview.name}
                </h4>
                <p className="text-[11px] font-mono text-primary-600 truncate">
                  {activePatientPreview.uhid}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 text-xs border-t border-[var(--color-border)] pt-2.5">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Insurance:</span>{' '}
                <span className="font-semibold text-success-600">
                  {activePatientPreview.insurance}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Token:</span>{' '}
                <span className="font-mono font-bold text-primary-600">
                  {activePatientPreview.token}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Department:</span>{' '}
                <span className="font-semibold">{activePatientPreview.dept}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Last Visit:</span>{' '}
                <span>{activePatientPreview.lastVisit}</span>
              </div>
            </div>

            {/* Patient Alerts */}
            {activePatientPreview.allergies.length > 0 && (
              <div className="p-2 rounded-lg bg-danger-50 text-danger-700 border border-danger-100 text-[11px] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Allergy: {activePatientPreview.allergies.join(', ')}</span>
              </div>
            )}
          </div>

          {/* Live Queue Tracker */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Live OPD Queue
              </h3>
              <span className="text-[10px] text-primary-600 font-mono">Auto-sync 5s</span>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {liveQueue.map((q) => (
                <div
                  key={q.id}
                  className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-primary-600 block">{q.token}</span>
                    <span className="text-[11px] text-[var(--color-text-primary)] font-medium truncate block max-w-[110px]">
                      {q.name}
                    </span>
                  </div>
                  <Badge
                    variant={
                      q.status === 'IN_CONSULTATION'
                        ? 'success'
                        : q.status === 'EMERGENCY'
                          ? 'danger'
                          : q.status === 'CALLED'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {q.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
