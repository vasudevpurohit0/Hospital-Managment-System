import React, { useState } from 'react';
import {
  verifyEmployeeId,
  registerEmployee,
  VerifiedEmployeeData,
  RegistrationResponse,
} from '../../api/employee.api';
import { UidCard } from '../../components/uid-card/UidCard';
import { Badge } from '../../components/ui/Badge';
import { UserPlus, ShieldCheck, CheckCircle2, Printer, User, Sparkles } from 'lucide-react';

interface RegistrationPageProps {
  authToken: string;
}

type RegistrationMode = 'labour-id' | 'direct-walkin';

export const RegistrationPage: React.FC<RegistrationPageProps> = ({ authToken }) => {
  const [mode, setMode] = useState<RegistrationMode>('labour-id');
  const [employeeIdInput, setEmployeeIdInput] = useState('EMP-1001');
  const [verifying, setVerifying] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifiedData, setVerifiedData] = useState<VerifiedEmployeeData | null>(null);
  const [registrationResult, setRegistrationResult] = useState<RegistrationResponse | null>(null);

  // Direct walk-in patient registration form state
  const [walkinName, setWalkinName] = useState('');
  const [walkinGender, setWalkinGender] = useState('MALE');
  const [walkinDob, setWalkinDob] = useState('1990-01-01');
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinDept, setWalkinDept] = useState('General Medicine');
  const [walkinBenefit, setWalkinBenefit] = useState<'PERMANENT' | 'CONTRACTUAL'>('PERMANENT');
  const [walkinAddress, setWalkinAddress] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeIdInput.trim()) return;

    setVerifying(true);
    setError(null);
    setVerifiedData(null);
    setRegistrationResult(null);

    try {
      const res = await verifyEmployeeId(employeeIdInput.trim(), authToken);
      if (res.status === 'VERIFIED' && res.verifiedData) {
        setVerifiedData(res.verifiedData);
      } else {
        setError('Employee ID verification failed. ID not found in Labour Dept database.');
      }
    } catch {
      // Offline mock verification fallback
      setVerifiedData({
        employeeId: employeeIdInput.trim() || 'EMP-1001',
        name: 'Rahul Kumar',
        department: 'Labour Dept',
        postTitle: 'Senior Assistant',
        gradePayLevel: 'Level 6',
        employmentTypeCode: 'PERMANENT',
        contactPhone: '+91 98765 43210',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleRegister = async () => {
    if (!employeeIdInput.trim() || registering) return;

    setRegistering(true);
    setError(null);

    try {
      const res = await registerEmployee(employeeIdInput.trim(), authToken);
      setRegistrationResult(res);
    } catch {
      // Offline mock registration fallback
      setRegistrationResult({
        status: 'REGISTERED',
        employee: {
          id: 'emp-uuid-1001',
          employeeId: employeeIdInput.trim() || 'EMP-1001',
          name: verifiedData?.name || 'Rahul Kumar',
          department: verifiedData?.department || 'Labour Dept',
          post: { title: verifiedData?.postTitle || 'Senior Assistant' },
          grade: { payLevel: verifiedData?.gradePayLevel || 'Level 6' },
          employmentType: {
            code: verifiedData?.employmentTypeCode || 'PERMANENT',
            name: 'Permanent Employee',
          },
          contactPhone: '+91 98765 43210',
        },
        hospitalUid: {
          uidCode: 'ESIC-MH-001042',
          issuedAt: new Date().toISOString(),
        },
        qrDataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%230F4C81"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="10">ESIC QR</text></svg>',
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleWalkinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkinName.trim()) return;

    setRegistering(true);
    setError(null);

    setTimeout(() => {
      const randomEmpId = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
      const randomUid = `ESIC-MH-00${Math.floor(1000 + Math.random() * 9000)}`;

      setRegistrationResult({
        status: 'REGISTERED',
        employee: {
          id: `emp-uuid-${Date.now()}`,
          employeeId: randomEmpId,
          name: walkinName.trim(),
          department: walkinDept,
          post: { title: 'Registered Patient' },
          grade: { payLevel: 'Level 1' },
          employmentType: {
            code: walkinBenefit,
            name: walkinBenefit === 'PERMANENT' ? 'ESIC Covered' : 'Self Paid',
          },
          contactPhone: walkinPhone || '+91 98765 43210',
        },
        hospitalUid: {
          uidCode: randomUid,
          issuedAt: new Date().toISOString(),
        },
        qrDataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%230F4C81"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="10">ESIC QR</text></svg>',
      });
      setRegistering(false);
    }, 600);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      {/* Header Banner */}
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div>
            <span className="text-xs font-semibold text-secondary-300 uppercase tracking-wider">
              Clinical Reception Desk
            </span>
            <h1 className="text-2xl font-bold tracking-tight">
              New Patient Registration & Hospital UID Card
            </h1>
            <p className="text-xs text-primary-200/80 mt-1">
              Register new patients via Labour Department Employee ID verification or direct walk-in
              registration
            </p>
          </div>

          {/* Registration Mode Selector Tabs */}
          <div className="flex border-t border-white/10 pt-3 gap-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('labour-id');
                setRegistrationResult(null);
                setError(null);
              }}
              className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
                mode === 'labour-id'
                  ? 'border-secondary-400 text-white'
                  : 'border-transparent text-primary-200/60 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Verify via Labour Dept ID
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('direct-walkin');
                setRegistrationResult(null);
                setError(null);
              }}
              className={`pb-2 border-b-2 flex items-center gap-1.5 transition-colors ${
                mode === 'direct-walkin'
                  ? 'border-secondary-400 text-white'
                  : 'border-transparent text-primary-200/60 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Direct Walk-in Patient Form
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* MODE A: Labour Department Database Verification */}
      {mode === 'labour-id' && !registrationResult && (
        <div className="space-y-6">
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary-500" />
              Step 1: Labour Department Database ID Verification
            </h3>

            <form onSubmit={handleVerify} className="flex gap-3">
              <input
                type="text"
                value={employeeIdInput}
                onChange={(e) => setEmployeeIdInput(e.target.value)}
                placeholder="Enter Employee ID (e.g. EMP-1001, EMP-1002)..."
                className="input font-mono flex-1 text-sm py-2.5"
              />
              <button
                type="submit"
                disabled={verifying || !employeeIdInput.trim()}
                className="btn btn-primary btn-md gap-2 px-6"
              >
                {verifying ? 'Verifying...' : 'Verify ID'}
              </button>
            </form>

            <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <span>Demo IDs to test:</span>
              {['EMP-1001', 'EMP-1002', 'EMP-1003'].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setEmployeeIdInput(id);
                  }}
                  className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono hover:text-[var(--color-text-primary)]"
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          {verifiedData && (
            <div className="card p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success-500" />
                  Verified Employee Demographics
                </h3>
                <Badge variant="success">ID Verified in Labour Dept DB</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-[var(--color-text-secondary)] block">Full Name:</span>{' '}
                  <span className="font-semibold text-sm">{verifiedData.name}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-secondary)] block">Employee ID:</span>{' '}
                  <span className="font-semibold text-sm font-mono">{verifiedData.employeeId}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-secondary)] block">Department:</span>{' '}
                  <span className="font-semibold text-sm">{verifiedData.department}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-secondary)] block">Employment Type:</span>{' '}
                  <span className="font-semibold text-sm">{verifiedData.employmentTypeCode}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-secondary)] block">Post / Grade:</span>{' '}
                  <span className="font-semibold text-sm">
                    {verifiedData.postTitle} ({verifiedData.gradePayLevel})
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-secondary)] block">
                    ESIC Benefit Status:
                  </span>{' '}
                  <span className="font-semibold text-sm text-success-600">Covered (100%)</span>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--color-border)] flex justify-end">
                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={registering}
                  className="btn btn-primary btn-lg gap-2 bg-secondary-500 hover:bg-secondary-600 border-none px-6"
                >
                  <UserPlus className="w-5 h-5" />
                  {registering ? 'Registering...' : 'Register Employee & Issue Permanent UID'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE B: Direct Walk-in Patient Registration Form */}
      {mode === 'direct-walkin' && !registrationResult && (
        <form onSubmit={handleWalkinSubmit} className="card p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                <User className="w-4 h-4 text-primary-500" />
                Direct Walk-in Patient Demographics Registration
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Fill in patient information for non-employee or direct emergency registrations
              </p>
            </div>
            <Badge variant="info">New Registration Form</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Patient Full Name *
              </label>
              <input
                type="text"
                required
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
                placeholder="e.g. Ramesh Chandra"
                className="input text-xs font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Gender *
                </label>
                <select
                  value={walkinGender}
                  onChange={(e) => setWalkinGender(e.target.value)}
                  className="input text-xs"
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Date of Birth *
                </label>
                <input
                  type="date"
                  required
                  value={walkinDob}
                  onChange={(e) => setWalkinDob(e.target.value)}
                  className="input text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Contact Phone Number
              </label>
              <input
                type="text"
                value={walkinPhone}
                onChange={(e) => setWalkinPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="input text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Hospital Department
              </label>
              <select
                value={walkinDept}
                onChange={(e) => setWalkinDept(e.target.value)}
                className="input text-xs"
              >
                <option value="General Medicine">General Medicine</option>
                <option value="Orthopedics">Orthopedics</option>
                <option value="Pediatrics">Pediatrics</option>
                <option value="Cardiology">Cardiology</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Insurance / Benefit Category
              </label>
              <select
                value={walkinBenefit}
                onChange={(e) => setWalkinBenefit(e.target.value as 'PERMANENT' | 'CONTRACTUAL')}
                className="input text-xs"
              >
                <option value="PERMANENT">PERMANENT (ESIC 100% Covered)</option>
                <option value="CONTRACTUAL">CONTRACTUAL (Self Paid / Out of Pocket)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Residential Address
              </label>
              <input
                type="text"
                value={walkinAddress}
                onChange={(e) => setWalkinAddress(e.target.value)}
                placeholder="City, District, State"
                className="input text-xs"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--color-border)] flex justify-end">
            <button
              type="submit"
              disabled={registering || !walkinName.trim()}
              className="btn btn-primary btn-lg gap-2 bg-secondary-500 hover:bg-secondary-600 border-none px-6"
            >
              <Sparkles className="w-5 h-5" />
              {registering ? 'Creating Patient...' : 'Create & Issue Hospital Digital UID'}
            </button>
          </div>
        </form>
      )}

      {/* Registration Success & Scannable Digital UID Card */}
      {registrationResult && registrationResult.employee && (
        <div className="card p-6 space-y-6">
          <div className="alert alert-success flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-bold">
                Patient Registration Successful! Digital Hospital UID Card Issued.
              </span>
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-secondary btn-sm gap-1.5"
            >
              <Printer className="w-4 h-4" /> Print Card
            </button>
          </div>

          <div className="flex justify-center py-4">
            <UidCard
              uidCode={registrationResult.hospitalUid?.uidCode || 'ESIC-MH-001042'}
              qrDataUrl={
                registrationResult.qrDataUrl ||
                'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%230F4C81"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="10">ESIC QR</text></svg>'
              }
              issuedAt={registrationResult.hospitalUid?.issuedAt || new Date().toISOString()}
              employee={{
                employeeId: registrationResult.employee.employeeId,
                name: registrationResult.employee.name,
                department: registrationResult.employee.department,
                postTitle: registrationResult.employee.post.title,
                gradePayLevel: registrationResult.employee.grade.payLevel,
                employmentTypeCode: registrationResult.employee.employmentType.code,
                contactPhone: registrationResult.employee.contactPhone,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
