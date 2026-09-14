import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../../components/ui/Badge';
import {
  UserPlus,
  Search,
  AlertTriangle,
  Printer,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Activity,
  Users,
  Ticket,
  Sparkles,
  CreditCard,
  X as XIcon,
} from 'lucide-react';

/** lucide-react's shipped type declarations for this version omit several
 * icon names (Camera included) even though they exist at runtime, so this
 * one is a small inline SVG instead of fighting the type mismatch. */
const CameraIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
import {
  VerifiedEmployeeData,
  RegistrationResponse,
} from '../../api/employee.api';
import { registerPatient, verifyEmployee, getPatientByEmployeeId, searchPatients } from '../../api/patient.api';
import { fetchBranding } from '../../api/security.api';
import {
  lookupPatientByUid,
  createVisit,
  PatientLookupResponse,
  CreateVisitResponse,
} from '../../api/patient-lookup.api';
import {
  fetchDepartments,
  fetchOpdQueue,
  createOpdVisit,
  Department,
  OPDVisitRecord,
} from '../../api/opd.api';
import { fetchDashboardMetrics, DashboardMetrics } from '../../api/dashboard.api';
import { fetchServices, ServiceListItem } from '../../api/catalog.api';
import { openTherapyCourse, scheduleTherapySession } from '../../api/therapy.api';
import { PatientWorkspace } from '../PatientWorkspace';

/* ═══════════════════════════════════════════════════════════
   Reception Workspace — Employee-ID verification/registration,
   universal patient search + repeat-visit token issue, and a
   real-time OPD queue overview.
   ═══════════════════════════════════════════════════════════ */

interface EnterpriseReceptionDeskProps {
  authToken: string;
  initialWorkflow?: ActiveWorkflow;
}

type ActiveWorkflow = 'dashboard' | 'esic-beneficiary' | 'universal-search' | 'success-slip';

export const EnterpriseReceptionDesk: React.FC<EnterpriseReceptionDeskProps> = ({
  authToken,
  initialWorkflow = 'dashboard',
}) => {
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow>(initialWorkflow);

  useEffect(() => {
    if (initialWorkflow) {
      setActiveWorkflow(initialWorkflow);
    }
  }, [initialWorkflow]);

  const [hospitalName, setHospitalName] = useState('ESIC Model Hospital & ODC');

  useEffect(() => {
    fetchBranding()
      .then((b) => b.hospitalName && setHospitalName(b.hospitalName))
      .catch(() => {
        // Non-fatal: printed slips/passes fall back to the default hospital name.
      });
  }, []);

  /* ── Departments, live OPD queue & dashboard metrics ── */
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [liveQueue, setLiveQueue] = useState<OPDVisitRecord[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    fetchDepartments(authToken)
      .then((depts) => {
        setDepartments(depts);
        if (depts.length > 0) setSelectedDeptId(depts[0].id);
      })
      .catch(() => {});
  }, [authToken]);

  const loadQueue = useCallback(async () => {
    if (!selectedDeptId) return;
    try {
      const q = await fetchOpdQueue(selectedDeptId, authToken);
      setLiveQueue(q);
    } catch {
      // transient polling failure — keep last known queue on screen
    }
  }, [selectedDeptId, authToken]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    fetchDashboardMetrics(authToken)
      .then(setMetrics)
      .catch(() => {});
  }, [authToken]);

  /* ── Employee-ID Verification & Registration Form ── */
  const [employeeIdInput, setEmployeeIdInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [verifiedData, setVerifiedData] = useState<VerifiedEmployeeData | null>(null);
  const [registrationResult, setRegistrationResult] = useState<RegistrationResponse | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [existingPatient, setExistingPatient] = useState<any | null>(null);

  /* Form Fields */
  const [careType, setCareType] = useState<'OPD' | 'IPD' | 'THERAPY'>('OPD');

  /* ── Therapy / Course selection — chosen directly in the initial
     Registration form (entry point 1), not as a separate step afterward. ── */
  const [therapyServices, setTherapyServices] = useState<ServiceListItem[]>([]);
  const [selectedTherapyServiceId, setSelectedTherapyServiceId] = useState('');
  const [therapyPlannedSessions, setTherapyPlannedSessions] = useState(1);

  useEffect(() => {
    if (careType === 'THERAPY') {
      fetchServices({ serviceType: 'THERAPY', active: true, limit: 100 }, authToken)
        .then((res) => setTherapyServices(res.items))
        .catch(() => {});
    }
  }, [careType, authToken]);

  const selectedTherapyService = therapyServices.find((s) => s.id === selectedTherapyServiceId);

  /**
   * Books the therapy/course chosen on the form against the just-opened
   * visit, in the same submit as registration — no separate "Select
   * Therapy / Course" step afterward. Returns a short status string reused
   * as the success view's "Token" line, the same slot IPD already reuses
   * for its own descriptive (non-token) status.
   */
  const bookSelectedTherapy = async (visitId: string): Promise<string> => {
    if (!selectedTherapyService) {
      throw new Error('Select a therapy or course before continuing.');
    }
    if (selectedTherapyService.unit === 'COURSE') {
      await openTherapyCourse(
        { visitId, serviceId: selectedTherapyService.id, plannedSessions: therapyPlannedSessions },
        authToken,
      );
      return `Course Opened: ${selectedTherapyService.name}`;
    }
    await scheduleTherapySession({ visitId, serviceId: selectedTherapyService.id }, authToken);
    return `Session Scheduled: ${selectedTherapyService.name}`;
  };

  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [address, setAddress] = useState('');
  const [allergies, setAllergies] = useState('');
  const [chronicDiseases, setChronicDiseases] = useState('');
  const [notes, setNotes] = useState('');

  /* Patient Pass State */
  const [issuePass, setIssuePass] = useState(true);
  const [passExpiryMode, setPassExpiryMode] = useState<'days' | 'date'>('days');
  const [passExpiryDays, setPassExpiryDays] = useState('30');
  const [passExpiryDate, setPassExpiryDate] = useState('');
  const [passData, setPassData] = useState<{
    passId: string;
    issueDate: string;
    expiryDate: string;
    validityLabel: string;
    patientName: string;
    uidCode: string;
    department: string;
    employmentType: string;
    visitType: string;
  } | null>(null);
  const [activePrintView, setActivePrintView] = useState<'slip' | 'pass'>('slip');

  /* Patient Search Filter State */
  const [filterVisitType, setFilterVisitType] = useState<'ALL' | 'OPD' | 'IPD'>('ALL');
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const resetVerificationState = () => {
    setVerifiedData(null);
    setExistingPatient(null);
    setRegistrationResult(null);
    setIssuedToken(null);
    setPhotoUrl('');
    setRegistrationError(null);
    setPassData(null);
    setActivePrintView('slip');
    setPassExpiryMode('days');
    setPassExpiryDays('30');
    setPassExpiryDate('');
    setSelectedTherapyServiceId('');
    setTherapyPlannedSessions(1);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setRegistrationError('Photo size must be under 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) setPhotoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeIdInput.trim()) return;

    setVerifying(true);
    resetVerificationState();

    try {
      // Bug fix: this used to call /api/employees/verify (EmployeeVerificationService),
      // a legacy verification path that never checks for an existing patient at all —
      // existingPatient was always undefined, so the "patient already registered"
      // branch below never ran. Registration/verify-employee (PatientService) does
      // the same Labour Dept check but also reports existingPatient, letting an
      // already-registered patient continue straight to a new visit/service instead
      // of hitting the ALREADY_REGISTERED conflict only at final submission.
      const res = await verifyEmployee(employeeIdInput.trim(), authToken);
      if (res.status === 'VERIFIED' && res.verifiedData) {
        setVerifiedData(res.verifiedData);
        setContactPhone(res.verifiedData.contactPhone || '');
        setContactEmail(res.verifiedData.contactEmail || '');
        setExistingPatient(res.existingPatient || null);
      } else {
        setRegistrationError(res.message || 'Employee ID not found in Labour Dept database.');
      }
    } catch (err: unknown) {
      setRegistrationError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const generatePassData = (pName: string, uid: string, dept?: string, empType?: string) => {
    const now = new Date();
    let exp: Date;
    let validityLabel: string;

    if (passExpiryMode === 'date' && passExpiryDate) {
      exp = new Date(passExpiryDate);
      const diffMs = exp.getTime() - now.getTime();
      const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      validityLabel = `${diffDays} Day${diffDays !== 1 ? 's' : ''}`;
    } else {
      const days = Math.max(1, parseInt(passExpiryDays, 10) || 30);
      exp = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      validityLabel = `${days} Day${days !== 1 ? 's' : ''}`;
    }

    return {
      passId: 'PASS-' + Math.floor(100000 + Math.random() * 900000),
      issueDate: now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      expiryDate: exp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      validityLabel,
      patientName: pName,
      uidCode: uid,
      department: dept || verifiedData?.department || selectedDept?.name || 'General OPD',
      employmentType: empType || verifiedData?.employmentTypeCode || 'Permanent Employee',
      visitType: careType,
    };
  };

  const handleRegisterAndIssueToken = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!employeeIdInput.trim() || registering) return;

    // Therapy selects its therapy or course right here on the
    // initial form — validate it up front, before creating anything, the
    // same way the OPD department picker is implicitly required by the
    // browser's native <select required>.
    if (careType === 'THERAPY' && !selectedTherapyServiceId) {
      setRegistrationError('Select a therapy or course before continuing.');
      return;
    }

    setRegistering(true);
    setRegistrationError(null);

    try {
      if (existingPatient) {
        // Patient already exists, create new Visit. Therapy books against a
        // bare OPD-typed visit (VisitType has no THERAPY value) — what makes
        // it a Direct-Therapy visit is simply that no OPDVisit token gets
        // created for it below, which TherapyService reads back later.
        const visitRes = await createVisit(
          { employeeId: existingPatient.id, type: careType === 'THERAPY' ? 'OPD' : careType },
          authToken,
        );

        if (visitRes.status === 'CREATED' && visitRes.visit) {
          if (careType === 'OPD' && selectedDeptId) {
            const opdRes = await createOpdVisit(
              { visitId: visitRes.visit.id, departmentId: selectedDeptId },
              authToken,
            );
            setIssuedToken(opdRes.tokenNumber);
          } else if (careType === 'IPD') {
            setIssuedToken('IPD-ADMISSION-REQUESTED');
          } else if (careType === 'THERAPY') {
            // Booked in this same submit — no separate "Select Therapy /
            // Course" step afterward.
            setIssuedToken(await bookSelectedTherapy(visitRes.visit.id));
          }
        }

        // Load the patient's actual saved record rather than reconstructing
        // an approximation from Labour Dept verifiedData — the point of
        // continuing an existing patient is that their previously saved
        // information (photo, post/grade at registration, etc.) loads as-is.
        let savedRecord: Awaited<ReturnType<typeof getPatientByEmployeeId>> | null = null;
        try {
          savedRecord = await getPatientByEmployeeId(existingPatient.employeeId, authToken);
        } catch {
          // Fall back to the minimal fields already known from verification below.
        }

        setRegistrationResult({
          status: 'REGISTERED',
          employee: {
            id: existingPatient.id,
            employeeId: existingPatient.employeeId,
            name: savedRecord?.name || existingPatient.name,
            department: savedRecord?.department || verifiedData?.department || '',
            post: { title: savedRecord?.post || verifiedData?.postTitle || 'Officer' },
            grade: { payLevel: savedRecord?.grade || verifiedData?.gradePayLevel || 'Pay Level 4' },
            employmentType: {
              code: savedRecord?.employmentType || verifiedData?.employmentTypeCode || 'PERMANENT',
              name:
                savedRecord?.employmentTypeName ||
                (verifiedData?.employmentTypeCode === 'CONTRACTUAL' ? 'Contractual Employee' : 'Permanent Employee'),
            },
          },
          hospitalUid: {
            uidCode: savedRecord?.hospitalUid || existingPatient.hospitalUid || 'UHID-REG',
            issuedAt: existingPatient.registeredAt,
          },
          patientProfile: {
            photoUrl: savedRecord?.photoUrl || null,
          },
        });

        if (issuePass) {
          setPassData(
            generatePassData(
              savedRecord?.name || existingPatient.name,
              savedRecord?.hospitalUid || existingPatient.hospitalUid || 'UHID-REG',
              savedRecord?.department,
              savedRecord?.employmentTypeName,
            ),
          );
        }

        setActiveWorkflow('success-slip');
      } else {
        // Normal first-time registration flow
        const res = await registerPatient(
          {
            employeeId: employeeIdInput.trim(),
            dob: dob || undefined,
            gender: gender || undefined,
            address: address || undefined,
            allergies: allergies || undefined,
            chronicDiseases: chronicDiseases || undefined,
            bloodGroup: bloodGroup || undefined,
            contactPhone: contactPhone || undefined,
            contactEmail: contactEmail || undefined,
            photoUrl: photoUrl || undefined,
            notes: notes || undefined,
          },
          authToken,
        );
        setRegistrationResult(res);

        const empId = res.employee?.id || res.patient?.id;
        const generatedUid = res.hospitalUid?.uidCode || 'UHID-GENERATED';
        const pName = res.employee?.name || verifiedData?.name || 'Patient';

        if (empId) {
          const visitRes = await createVisit(
            { employeeId: empId, type: careType === 'THERAPY' ? 'OPD' : careType },
            authToken,
          );
          if (visitRes.status === 'CREATED' && visitRes.visit) {
            if (careType === 'OPD' && selectedDeptId) {
              const opdRes = await createOpdVisit(
                { visitId: visitRes.visit.id, departmentId: selectedDeptId },
                authToken,
              );
              setIssuedToken(opdRes.tokenNumber);
            } else if (careType === 'IPD') {
              setIssuedToken('IPD-ADMISSION-REQUESTED');
            } else if (careType === 'THERAPY') {
              setIssuedToken(await bookSelectedTherapy(visitRes.visit.id));
            }
          }
        }

        if (issuePass) {
          setPassData(generatePassData(pName, generatedUid));
        }

        setActiveWorkflow('success-slip');
      }
    } catch (err: unknown) {
      setRegistrationError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  /* ── Patient Search & Repeat-Visit Token ── */
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [patientData, setPatientData] = useState<PatientLookupResponse | null>(null);
  const [visitType, setVisitType] = useState<'OPD' | 'IPD'>('OPD');
  const [creatingVisit, setCreatingVisit] = useState(false);
  const [openVisitWarning, setOpenVisitWarning] = useState<CreateVisitResponse | null>(null);
  const [visitSuccessMessage, setVisitSuccessMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    { id: string; name: string; hospitalUid: string; employeeId: string; mobile: string; department: string }[]
  >([]);

  /** Loads the full lookup payload the rest of this workflow expects,
   *  keyed by whichever identifier the patient actually has. */
  const loadPatientByIdentifier = async (identifier: string) => {
    const result = await lookupPatientByUid(identifier, authToken);
    setPatientData(result);
    setSearchResults([]);
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) return;

    setSearching(true);
    setSearchError(null);
    setOpenVisitWarning(null);
    setVisitSuccessMessage(null);
    setPatientData(null);
    setSearchResults([]);

    try {
      // Broad search first — matches name, mobile, email, Employee ID, UHID,
      // or any OPD/IPD/lab/receipt number — so reception can find a patient
      // by whatever detail they were given, not only an exact UHID.
      const found = await searchPatients({ query: query.trim(), limit: 10 }, authToken);
      const items: any[] = found?.items || [];

      if (items.length === 0) {
        setSearchError(`No patient found matching "${query.trim()}"`);
      } else if (items.length === 1) {
        await loadPatientByIdentifier(items[0].hospitalUid !== '—' ? items[0].hospitalUid : items[0].employeeId);
      } else {
        setSearchResults(
          items.map((it) => ({
            id: it.id,
            name: it.name,
            hospitalUid: it.hospitalUid,
            employeeId: it.employeeId,
            mobile: it.mobile,
            department: it.department,
          })),
        );
      }
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Patient lookup failed');
    } finally {
      setSearching(false);
    }
  };

  const handlePickSearchResult = async (identifier: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      await loadPatientByIdentifier(identifier);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Patient lookup failed');
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(searchInput);
  };

  const handleCreateVisit = async (ignoreWarning = false) => {
    if (!patientData || creatingVisit) return;

    setCreatingVisit(true);
    setSearchError(null);
    setVisitSuccessMessage(null);

    try {
      const res = await createVisit(
        {
          employeeId: patientData.employee.id,
          type: visitType,
          ignoreOpenVisitWarning: ignoreWarning,
        },
        authToken,
      );

      if (res.status === 'OPEN_VISIT_WARNING' && !ignoreWarning) {
        setOpenVisitWarning(res);
      } else if (res.status === 'CREATED' && res.visit) {
        setOpenVisitWarning(null);

        if (visitType === 'OPD' && selectedDeptId) {
          const opdRes = await createOpdVisit(
            { visitId: res.visit.id, departmentId: selectedDeptId },
            authToken,
          );
          setVisitSuccessMessage(`New OPD Visit Created! Queue Token issued: ${opdRes.tokenNumber}`);
        } else {
          setVisitSuccessMessage(`New ${res.visit.type} Visit created successfully!`);
        }
      }
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Failed to create visit');
    } finally {
      setCreatingVisit(false);
    }
  };

  /* ── Global Keyboard Shortcuts ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveWorkflow('esic-beneficiary');
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

  const selectedDept = departments.find((d) => d.id === selectedDeptId);

  const previewEmployee =
    patientData?.employee ||
    registrationResult?.employee ||
    (verifiedData
      ? {
          employeeId: verifiedData.employeeId,
          name: verifiedData.name,
          department: verifiedData.department,
          employmentType: verifiedData.employmentTypeCode,
        }
      : null);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ─── PRINT-ONLY DEDICATED SLIPS ─── */}
      {activeWorkflow === 'success-slip' && registrationResult?.employee && (
        <>
          {/* Registration Slip Print */}
          {activePrintView === 'slip' && (
            <div className="hidden print:block registration-slip-print-only">
              <div className="slip-header-container">
                <div className="slip-header-text">
                  <h2>{hospitalName}</h2>
                  <p className="slip-subtitle">Ministry of Labour & Employment, Govt. of India</p>
                  <h3>PATIENT REGISTRATION SLIP</h3>
                </div>
                <div className="slip-photo-box">
                  {registrationResult.patientProfile?.photoUrl || registrationResult.employee.patientProfile?.photoUrl || photoUrl ? (
                    <img
                      src={registrationResult.patientProfile?.photoUrl || registrationResult.employee.patientProfile?.photoUrl || photoUrl}
                      alt="Patient"
                      className="slip-photo"
                    />
                  ) : (
                    <div className="slip-photo-placeholder">Photo Not Available</div>
                  )}
                </div>
              </div>
              <div className="slip-divider" />
              <table className="slip-details">
                <tbody>
                  <tr>
                    <td><strong>Patient Name:</strong></td>
                    <td>{registrationResult.employee.name}</td>
                  </tr>
                  <tr>
                    <td><strong>Hospital UHID:</strong></td>
                    <td className="font-mono">{registrationResult.hospitalUid?.uidCode}</td>
                  </tr>
                  {issuedToken && (
                    <tr>
                      <td><strong>Token Number:</strong></td>
                      <td className="font-mono font-bold">{issuedToken}</td>
                    </tr>
                  )}
                  <tr>
                    <td><strong>Department:</strong></td>
                    <td>{registrationResult.employee.department}</td>
                  </tr>
                  <tr>
                    <td><strong>Employment Type:</strong></td>
                    <td>{registrationResult.employee.employmentType.name}</td>
                  </tr>
                  <tr>
                    <td><strong>Reg Date & Time:</strong></td>
                    <td>{new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                </tbody>
              </table>
              <div className="slip-divider" />
              <div className="slip-footer">
                <p>Please proceed to the department OPD waiting area.</p>
                <p className="footer-small">Sourced from ESIC HMS Real-time Registry</p>
              </div>
            </div>
          )}

          {/* Patient Pass Print */}
          {activePrintView === 'pass' && passData && (
            <div className="hidden print:block patient-pass-print-only">
              <div className="text-center border-b-2 border-black pb-2 mb-3">
                <h2 style={{ fontSize: '15px', fontWeight: 'bold', margin: '0 0 2px 0' }}>{hospitalName}</h2>
                <p style={{ fontSize: '9px', margin: '0 0 4px 0' }}>Ministry of Labour &amp; Employment, Govt. of India</p>
                <div style={{ border: '1px solid #000', padding: '3px 10px', fontWeight: 'bold', fontSize: '11px', display: 'inline-block' }}>
                  OFFICIAL PATIENT PASS — VALID {passData.validityLabel.toUpperCase()}
                </div>
              </div>

              <div className="slip-header-container">
                <div className="slip-header-text" style={{ fontSize: '11px' }}>
                  <p style={{ margin: '3px 0' }}><strong>Pass ID:</strong> <span className="font-mono">{passData.passId}</span></p>
                  <p style={{ margin: '3px 0' }}><strong>Patient Name:</strong> <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{passData.patientName}</span></p>
                  <p style={{ margin: '3px 0' }}><strong>Hospital UHID:</strong> <span className="font-mono font-bold">{passData.uidCode}</span></p>
                  <p style={{ margin: '3px 0' }}><strong>Department:</strong> {passData.department}</p>
                  <p style={{ margin: '3px 0' }}><strong>Employment Type:</strong> {passData.employmentType}</p>
                  <p style={{ margin: '3px 0' }}><strong>Visit Type:</strong> <span style={{ fontWeight: 'bold' }}>{passData.visitType}</span></p>
                </div>
                <div className="slip-photo-box">
                  {photoUrl ? (
                    <img src={photoUrl} alt="Patient" className="slip-photo" />
                  ) : (
                    <div className="slip-photo-placeholder">PATIENT PHOTO</div>
                  )}
                </div>
              </div>

              <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', margin: '8px 0', padding: '6px 0', fontSize: '11px' }}>
                <p style={{ margin: '2px 0' }}><strong>Issue Date:</strong> {passData.issueDate}</p>
                <p style={{ margin: '2px 0', fontSize: '12px', fontWeight: 'bold' }}>
                  <strong>Expiration Date ({passData.validityLabel}):</strong> {passData.expiryDate}
                </p>
              </div>

              <div style={{ textAlign: 'center', fontSize: '9px', marginTop: '8px' }}>
                <p style={{ margin: '2px 0' }}>* Valid for {passData.validityLabel} entry into hospital premises &amp; OPD/IPD departments.</p>
                <p style={{ margin: '2px 0', fontWeight: 'bold' }}>Authorized by Hospital Security &amp; Gate Control</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Screen layout container — hidden when printing */}
      <div className="print:hidden space-y-6">
        {/* Top Operational Reception KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Patients Waiting (OPD)',
              val: metrics ? String(metrics.opd.waitingQueue) : '—',
              color: 'text-warning-600',
              icon: Clock,
            },
            {
              label: "Today's OPD Visits",
              val: metrics ? String(metrics.opd.totalVisits) : '—',
              color: 'text-primary-600',
              icon: UserPlus,
            },
            {
              label: 'Active Admissions',
              val: metrics ? String(metrics.ipd.activeAdmissions) : '—',
              color: 'text-info-600',
              icon: Users,
            },
            {
              label: 'Bed Occupancy',
              val: metrics ? `${metrics.ipd.bedOccupancyRate}%` : '—',
              color: 'text-success-600',
              icon: Activity,
            },
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

        {/* Main 3-Column Enterprise Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Quick Actions */}
          <div className="lg:col-span-3 space-y-4">
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
                <span>Verify & Register (Ctrl+N)</span>
              </button>

              <button
                onClick={() => setActiveWorkflow('universal-search')}
                className={`w-full btn btn-md justify-start gap-2.5 ${
                  activeWorkflow === 'universal-search' ? 'btn-primary' : 'btn-secondary'
                }`}
              >
                <Search className="w-4 h-4 text-info-500" />
                <span>Patient Search (Ctrl+F)</span>
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
          </div>

          {/* CENTER COLUMN: Operational Workflow Manager */}
          <div className="lg:col-span-6 space-y-5">
            {/* WORKFLOW: Reception Live OPD Queue Overview */}
            {activeWorkflow === 'dashboard' && (
              <div className="card p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                  <div>
                    <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                      Reception Operational Queue Console
                    </h2>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Real-time OPD token flow, sourced live from the department queue
                    </p>
                  </div>
                  <Badge variant="success" dot>
                    Live Operations
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Department:
                  </label>
                  <select
                    value={selectedDeptId}
                    onChange={(e) => setSelectedDeptId(e.target.value)}
                    className="input text-xs font-semibold py-1.5"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {liveQueue.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
                      No patients currently in the {selectedDept?.name || 'selected'} queue.
                    </div>
                  ) : (
                    liveQueue.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-mono font-bold text-primary-600 block">
                            {q.tokenNumber}
                          </span>
                          <span className="text-[var(--color-text-primary)] font-medium">
                            {q.visit?.employee?.name || 'Patient'}
                          </span>
                        </div>
                        <Badge variant={q.calledAt ? 'success' : 'warning'}>
                          {q.calledAt ? 'CALLED' : 'WAITING'}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}


            {/* WORKFLOW: Employee-ID Verification & Registration */}
            {activeWorkflow === 'esic-beneficiary' && (
              <div className="card p-5 space-y-5">
                <div className="border-b border-[var(--color-border)] pb-3">
                  <Badge variant="info" className="mb-1">
                    Labour Department Verification
                  </Badge>
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Employee ID Verification & Hospital UID Registration
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Enter the ESIC Labour Department Employee ID to verify and register the patient
                  </p>
                </div>

                <form onSubmit={handleVerify} className="flex gap-2">
                  <input
                    type="text"
                    value={employeeIdInput}
                    onChange={(e) => setEmployeeIdInput(e.target.value)}
                    placeholder="Enter Employee ID (e.g. EMP-1001)..."
                    className="input font-mono flex-1 text-xs py-2"
                  />
                  <button type="submit" disabled={verifying} className="btn btn-primary btn-md">
                    {verifying ? 'Verifying...' : 'Verify ID'}
                  </button>
                </form>

                {registrationError && <div className="alert alert-danger">{registrationError}</div>}

                {verifiedData && (
                  <form onSubmit={handleRegisterAndIssueToken} className="space-y-4 pt-3 border-t border-[var(--color-border)]">
                    <div className="p-3 rounded-xl bg-primary-50 text-primary-900 border border-primary-200 text-xs flex justify-between items-center">
                      <div>
                        <span className="font-bold block text-sm">{verifiedData.name}</span>
                        <span className="text-[11px] font-mono">
                          Employee ID: {verifiedData.employeeId} • Department: {verifiedData.department}
                        </span>
                      </div>
                      <Badge variant="success">Verified Beneficiary</Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs p-3 rounded-lg bg-[var(--color-surface-secondary)]">
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">Post / Grade:</span>
                        <span className="font-semibold text-sm">
                          {verifiedData.postTitle} ({verifiedData.gradePayLevel})
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">Employment Type:</span>
                        <span className="font-semibold text-sm">{verifiedData.employmentTypeCode}</span>
                      </div>
                    </div>

                    {existingPatient && (
                      <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 text-amber-900 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span>⚠️</span>
                          <span>Patient Already Registered</span>
                        </div>
                        <p className="text-gray-600">
                          Patient is already registered in ESIC HMS with UHID: <strong className="font-mono text-[13px] text-amber-950">{existingPatient.hospitalUid}</strong>.
                          Creating a new OPD/IPD visit instead of a duplicate registration record.
                        </p>
                      </div>
                    )}

                    {/* Patient Profile Form Controls */}
                    <div className="card p-4 bg-gray-50/60 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 space-y-4">
                      <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">
                          Patient Profile & Medical Details Form
                        </h3>
                        <Badge variant={careType === 'IPD' ? 'warning' : careType === 'THERAPY' ? 'success' : 'info'}>
                          Selected Mode:{' '}
                          {careType === 'IPD'
                            ? '🏥 IPD Emergency Admission'
                            : careType === 'THERAPY'
                              ? '💆 Therapy / Panchakarma'
                              : '🩺 OPD Consultation'}
                        </Badge>
                      </div>

                      {/* Care & Service Classification Switcher */}
                      <div className="p-3.5 rounded-xl border border-primary-200 bg-primary-50/50 space-y-2">
                        <label className="text-xs font-bold text-primary-900 block">
                          Care & Service Classification *
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setCareType('OPD')}
                            className={`p-3 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                              careType === 'OPD'
                                ? 'bg-white border-primary-500 text-primary-900 shadow-sm ring-2 ring-primary-500/20'
                                : 'bg-gray-50/70 border-gray-200 text-gray-600 hover:bg-white'
                            }`}
                          >
                            <span className="text-lg">🩺</span>
                            <div>
                              <span className="font-bold block">OPD Outpatient Consultation</span>
                              <span className="text-[11px] text-gray-500 block">
                                Routine OPD Queue token. Bed allocation restricted unless doctor prescribes IPD.
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCareType('IPD')}
                            className={`p-3 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                              careType === 'IPD'
                                ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-sm ring-2 ring-amber-500/20'
                                : 'bg-gray-50/70 border-gray-200 text-gray-600 hover:bg-white'
                            }`}
                          >
                            <span className="text-lg">🏥</span>
                            <div>
                              <span className="font-bold block text-amber-900">IPD Emergency Admission</span>
                              <span className="text-[11px] text-amber-700/90 block">
                                Direct Inpatient Admission. Generates IPD request for immediate Ward Bed Allocation.
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCareType('THERAPY')}
                            className={`p-3 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                              careType === 'THERAPY'
                                ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-sm ring-2 ring-emerald-500/20'
                                : 'bg-gray-50/70 border-gray-200 text-gray-600 hover:bg-white'
                            }`}
                          >
                            <span className="text-lg">💆</span>
                            <div>
                              <span className="font-bold block text-emerald-900">Therapy / Panchakarma</span>
                              <span className="text-[11px] text-emerald-700/90 block">
                                Direct therapy visit — no OPD consultation or IPD admission required.
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Select Therapy / Course — chosen right here in the initial
                          Registration form, for both new and existing patients, so
                          there is no separate step after the visit opens. */}
                      {careType === 'THERAPY' && (
                        <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10 dark:border-emerald-900 space-y-2">
                          <label className="text-xs font-bold text-emerald-900 dark:text-emerald-300 block">
                            Select Therapy / Course *
                          </label>
                          <select
                            value={selectedTherapyServiceId}
                            onChange={(e) => setSelectedTherapyServiceId(e.target.value)}
                            className="input text-xs py-2 w-full"
                            required
                          >
                            <option value="">-- Select from Therapy / Panchakarma Catalogue --</option>
                            {therapyServices.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.currentPrice ? `— ₹${s.currentPrice}` : '(unpriced — administrator must set a rate)'} [{s.unit}]
                              </option>
                            ))}
                          </select>

                          {selectedTherapyService?.unit === 'COURSE' && (
                            <div>
                              <label className="text-xs font-semibold text-emerald-900 dark:text-emerald-300 block mb-1">
                                Planned Sessions in Course
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={60}
                                value={therapyPlannedSessions}
                                onChange={(e) => setTherapyPlannedSessions(Number(e.target.value))}
                                className="input text-xs py-1.5 w-32"
                              />
                            </div>
                          )}

                          {selectedTherapyService && (
                            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                              {selectedTherapyService.unit === 'COURSE'
                                ? `Bills the full course rate once${selectedTherapyService.currentPrice ? ` — ₹${selectedTherapyService.currentPrice}` : ''} when registration is submitted.`
                                : `Bills ${selectedTherapyService.currentPrice ? `₹${selectedTherapyService.currentPrice}` : 'once priced'} when the therapist marks the session performed.`}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Photo Upload */}
                      {!existingPatient && (
                        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-2.5 shadow-sm">
                          <label className="text-xs font-bold text-[var(--color-text-primary)] flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-primary-700 dark:text-primary-400 font-semibold">
                              <span>📷</span> Patient Identification Photo
                            </span>
                            <span className="text-[11px] font-normal text-gray-500">
                              Supports PNG, JPG, WEBP (Max 5MB)
                            </span>
                          </label>

                          <div className="flex items-center gap-4">
                            {photoUrl ? (
                              <div className="relative group">
                                <img
                                  src={photoUrl}
                                  alt="Patient Photo Preview"
                                  className="w-16 h-16 rounded-xl object-cover border-2 border-primary-500 shadow-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => setPhotoUrl('')}
                                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-600 transition-colors"
                                  title="Remove Photo"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="text-[9px] mt-0.5 font-medium">No Photo</span>
                              </div>
                            )}

                            <div className="space-y-1 flex-1">
                              <div className="flex flex-wrap gap-2">
                                <label className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 cursor-pointer inline-flex items-center gap-1.5 transition-colors">
                                  <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                  </svg>
                                  <span>{photoUrl ? 'Change Photo' : 'Upload Photo'}</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoUpload}
                                    className="hidden"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setShowCameraModal(true)}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 inline-flex items-center gap-1.5 transition-colors"
                                >
                                  <CameraIcon className="w-4 h-4 text-emerald-600" />
                                  <span>Capture from Camera</span>
                                </button>
                              </div>
                              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                Sourced for Patient Record & 30-Day Gate Visitor Pass
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {!existingPatient && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            {careType !== 'THERAPY' && (
                              <div>
                                <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                  Initial OPD Department *
                                </label>
                                <select
                                  value={selectedDeptId}
                                  onChange={(e) => setSelectedDeptId(e.target.value)}
                                  className="input text-xs font-semibold py-2 w-full"
                                  required
                                >
                                  {departments.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name} ({d.code})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Date of Birth
                              </label>
                              <input
                                type="date"
                                value={dob}
                                onChange={(e) => setDob(e.target.value)}
                                className="input text-xs py-2 w-full"
                              />
                            </div>

                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Gender
                              </label>
                              <select
                                value={gender}
                                onChange={(e) => setGender(e.target.value)}
                                className="input text-xs py-2 w-full"
                              >
                                <option value="">Select Gender</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                                <option value="OTHER">Other</option>
                              </select>
                            </div>

                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Blood Group
                              </label>
                              <select
                                value={bloodGroup}
                                onChange={(e) => setBloodGroup(e.target.value)}
                                className="input text-xs py-2 w-full"
                              >
                                <option value="">Select Blood Group</option>
                                <option value="A+">A+</option>
                                <option value="A-">A-</option>
                                <option value="B+">B+</option>
                                <option value="B-">B-</option>
                                <option value="O+">O+</option>
                                <option value="O-">O-</option>
                                <option value="AB+">AB+</option>
                                <option value="AB-">AB-</option>
                              </select>
                            </div>

                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Contact Phone Number
                              </label>
                              <input
                                type="text"
                                value={contactPhone}
                                onChange={(e) => setContactPhone(e.target.value)}
                                placeholder="+91 9876543210"
                                className="input text-xs py-2 w-full"
                              />
                            </div>

                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Email Address
                              </label>
                              <input
                                type="email"
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                placeholder="patient@example.com"
                                className="input text-xs py-2 w-full"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Residential Address
                              </label>
                              <input
                                type="text"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Street Address, City, State, PIN"
                                className="input text-xs py-2 w-full"
                              />
                            </div>
                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Known Allergies
                              </label>
                              <input
                                type="text"
                                value={allergies}
                                onChange={(e) => setAllergies(e.target.value)}
                                placeholder="e.g. Penicillin allergy, Latex allergy"
                                className="input text-xs py-2 w-full"
                              />
                            </div>
                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Chronic Diseases
                              </label>
                              <input
                                type="text"
                                value={chronicDiseases}
                                onChange={(e) => setChronicDiseases(e.target.value)}
                                placeholder="e.g. Diabetes, Hypertension"
                                className="input text-xs py-2 w-full"
                              />
                            </div>
                            <div>
                              <label className="font-semibold text-[var(--color-text-secondary)] block mb-1">
                                Registration Notes
                              </label>
                              <input
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Additional administrative notes..."
                                className="input text-xs py-2 w-full"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {/* Patient Pass Option Section */}
                      <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-800/40 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-indigo-950 dark:text-indigo-200">
                            <input
                              type="checkbox"
                              checked={issuePass}
                              onChange={(e) => setIssuePass(e.target.checked)}
                              className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            />
                            <span className="flex items-center gap-1.5 text-xs sm:text-sm">
                              <span>🎫</span> Issue Patient Pass
                            </span>
                          </label>
                          <Badge variant="warning" className="text-[10px]">
                            Custom Expiry
                          </Badge>
                        </div>

                        {issuePass && (
                          <div className="pt-2 border-t border-indigo-200/70 space-y-3">
                            <p className="text-xs text-indigo-900 dark:text-indigo-300">
                              Generates an official Patient Gate &amp; Department Access Pass with Patient Details &amp; UHID.
                            </p>

                            {/* Expiry Mode Toggle */}
                            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                              <span>Expiry by:</span>
                              <button
                                type="button"
                                onClick={() => setPassExpiryMode('days')}
                                className={`px-3 py-1 rounded-full border transition-colors ${
                                  passExpiryMode === 'days'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-gray-800 border-indigo-300 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50'
                                }`}
                              >
                                Number of Days
                              </button>
                              <button
                                type="button"
                                onClick={() => setPassExpiryMode('date')}
                                className={`px-3 py-1 rounded-full border transition-colors ${
                                  passExpiryMode === 'date'
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white dark:bg-gray-800 border-indigo-300 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50'
                                }`}
                              >
                                Specific Date
                              </button>
                            </div>

                            {/* Expiry Input */}
                            {passExpiryMode === 'days' ? (
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-indigo-900 dark:text-indigo-200 shrink-0">
                                  Expires in:
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={passExpiryDays}
                                  onChange={(e) => setPassExpiryDays(e.target.value)}
                                  className="input text-xs py-1.5 w-24 font-mono text-center"
                                  placeholder="30"
                                />
                                <span className="text-xs text-indigo-900 dark:text-indigo-200 font-semibold">days</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-indigo-900 dark:text-indigo-200 shrink-0">
                                  Expiry Date:
                                </label>
                                <input
                                  type="date"
                                  value={passExpiryDate}
                                  min={new Date().toISOString().split('T')[0]}
                                  onChange={(e) => setPassExpiryDate(e.target.value)}
                                  className="input text-xs py-1.5 font-mono"
                                />
                              </div>
                            )}

                            {/* Live Preview */}
                            <div className="p-2 bg-indigo-100/70 dark:bg-indigo-900/40 rounded text-[11px] text-indigo-900 dark:text-indigo-200 flex flex-wrap justify-between items-center font-mono gap-2">
                              <span>Issue Date: <strong>{new Date().toLocaleDateString('en-IN')}</strong></span>
                              <span>
                                Expiry Date:{' '}
                                <strong className="text-amber-800 dark:text-amber-300 font-bold">
                                  {passExpiryMode === 'date' && passExpiryDate
                                    ? new Date(passExpiryDate).toLocaleDateString('en-IN')
                                    : new Date(Date.now() + Math.max(1, parseInt(passExpiryDays, 10) || 30) * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN')
                                  }{' '}
                                  ({passExpiryMode === 'date' && passExpiryDate
                                    ? `${Math.max(1, Math.round((new Date(passExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} Days`
                                    : `${Math.max(1, parseInt(passExpiryDays, 10) || 30)} Days`
                                  })
                                </strong>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={resetVerificationState}
                        className="btn btn-secondary btn-md"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={registering || (careType === 'THERAPY' && !selectedTherapyServiceId)}
                        className={`btn btn-lg gap-2 border-none px-6 text-white disabled:opacity-50 ${
                          careType === 'IPD'
                            ? 'bg-amber-600 hover:bg-amber-700'
                            : careType === 'THERAPY'
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-secondary-500 hover:bg-secondary-600'
                        }`}
                      >
                        <Sparkles className="w-5 h-5" />
                        {registering
                          ? existingPatient
                            ? careType === 'THERAPY'
                              ? 'Booking Therapy...'
                              : 'Processing Visit...'
                            : 'Registering Patient...'
                          : existingPatient
                            ? careType === 'IPD'
                              ? 'Create IPD Admission Request'
                              : careType === 'THERAPY'
                                ? 'Create Therapy Visit & Book Session'
                                : 'Create OPD Visit & Issue Token'
                            : careType === 'IPD'
                              ? 'Submit Form & Request IPD Bed Allocation'
                              : careType === 'THERAPY'
                                ? 'Register Patient & Book Therapy Session'
                                : 'Submit Form & Issue Hospital UID + OPD Token'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* WORKFLOW: Patient Search & Repeat-Visit Token */}
            {activeWorkflow === 'universal-search' && (
              <div className="card p-5 space-y-4">
                <div className="border-b border-[var(--color-border)] pb-3">
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Patient Search
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Search by name, mobile number, email, Employee ID or UHID to load the
                    patient's record and issue a repeat visit token
                  </p>
                </div>

                {/* Search + Filter row */}
                <div className="flex gap-2 relative">
                  <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search by name, mobile, email, Employee ID or UHID..."
                        className="input input-with-icon text-xs py-2.5 font-mono w-full"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={searching || !searchInput.trim()}
                      className="btn btn-primary btn-md"
                    >
                      {searching ? 'Searching...' : 'Search'}
                    </button>
                  </form>

                  {/* Filter toggle button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowFilterDropdown((v) => !v)}
                      className={`btn btn-md gap-1.5 border transition-colors ${
                        showFilterDropdown || filterVisitType !== 'ALL' || filterYear
                          ? 'bg-primary-50 border-primary-400 text-primary-700 dark:bg-primary-900/30 dark:border-primary-600 dark:text-primary-300'
                          : 'btn-secondary'
                      }`}
                      title="Toggle Filters"
                    >
                      {/* Filter icon */}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                      </svg>
                      <span className="text-xs font-semibold hidden sm:inline">Filter</span>
                      {(filterVisitType !== 'ALL' || filterYear) && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 inline-block" />
                      )}
                    </button>

                    {/* Dropdown panel */}
                    {showFilterDropdown && (
                      <div className="absolute right-0 top-full mt-1.5 z-30 w-72 bg-white dark:bg-gray-900 border border-[var(--color-border)] rounded-xl shadow-xl p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Filters</span>
                          {(filterVisitType !== 'ALL' || filterYear) && (
                            <button
                              type="button"
                              onClick={() => { setFilterVisitType('ALL'); setFilterYear(''); setFilterMonth(''); setFilterDay(''); }}
                              className="text-[10px] text-red-500 hover:underline font-semibold"
                            >
                              Clear All
                            </button>
                          )}
                        </div>

                        {/* Visit Type */}
                        <div className="space-y-1.5">
                          <span className="text-xs font-semibold text-[var(--color-text-secondary)] block">Visit Type</span>
                          <div className="flex gap-1.5">
                            {(['ALL', 'OPD', 'IPD'] as const).map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setFilterVisitType(type)}
                                className={`flex-1 py-1 text-xs rounded-lg border font-semibold transition-colors ${
                                  filterVisitType === type
                                    ? type === 'OPD'
                                      ? 'bg-primary-600 text-white border-primary-600'
                                      : type === 'IPD'
                                        ? 'bg-amber-600 text-white border-amber-600'
                                        : 'bg-gray-600 text-white border-gray-600'
                                    : 'bg-white dark:bg-gray-800 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-gray-50'
                                }`}
                              >
                                {type === 'ALL' ? 'All' : type}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Cascading Date Filter */}
                        <div className="space-y-2">
                          <span className="text-xs font-semibold text-[var(--color-text-secondary)] block">Date Filter</span>

                          {/* Year */}
                          <div>
                            <label className="text-[10px] text-[var(--color-text-tertiary)] font-medium block mb-1">Year</label>
                            <select
                              value={filterYear}
                              onChange={(e) => { setFilterYear(e.target.value); setFilterMonth(''); setFilterDay(''); }}
                              className="input text-xs py-1.5 w-full"
                            >
                              <option value="">Any Year</option>
                              {Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                                <option key={y} value={String(y)}>{y}</option>
                              ))}
                            </select>
                          </div>

                          {/* Month — only if year selected */}
                          {filterYear && (
                            <div>
                              <label className="text-[10px] text-[var(--color-text-tertiary)] font-medium block mb-1">Month <span className="text-gray-400 font-normal">(optional)</span></label>
                              <select
                                value={filterMonth}
                                onChange={(e) => { setFilterMonth(e.target.value); setFilterDay(''); }}
                                className="input text-xs py-1.5 w-full"
                              >
                                <option value="">All Months</option>
                                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                                  <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Day — only if year + month selected */}
                          {filterYear && filterMonth && (
                            <div>
                              <label className="text-[10px] text-[var(--color-text-tertiary)] font-medium block mb-1">Day <span className="text-gray-400 font-normal">(optional)</span></label>
                              <select
                                value={filterDay}
                                onChange={(e) => setFilterDay(e.target.value)}
                                className="input text-xs py-1.5 w-full"
                              >
                                <option value="">All Days</option>
                                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                  <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Active filter summary */}
                          {filterYear && (
                            <p className="text-[10px] font-mono text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 px-2 py-1 rounded">
                              Showing visits for:{' '}
                              <strong>
                                {filterDay ? `${filterDay}/` : ''}{filterMonth ? `${filterMonth}/` : ''}{filterYear}
                              </strong>
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowFilterDropdown(false)}
                          className="w-full btn btn-secondary btn-sm text-xs"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {searchError && <div className="alert alert-danger">{searchError}</div>}

                {searchResults.length > 1 && (
                  <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                    <div className="px-3 py-2 text-xs font-bold bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]">
                      {searchResults.length} matching patients found — select one
                    </div>
                    <div className="divide-y divide-[var(--color-border)] max-h-72 overflow-y-auto">
                      {searchResults.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => handlePickSearchResult(r.hospitalUid !== '—' ? r.hospitalUid : r.employeeId)}
                          className="w-full text-left px-3 py-2.5 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{r.name}</p>
                            <p className="text-[11px] font-mono text-[var(--color-text-tertiary)]">
                              UHID: {r.hospitalUid} • Emp ID: {r.employeeId} • {r.department}
                            </p>
                          </div>
                          <span className="text-xs text-[var(--color-text-secondary)]">{r.mobile}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {patientData && (
                  <div className="p-4 rounded-xl border border-primary-200 bg-primary-50/40 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-[var(--color-text-primary)]">
                          {patientData.employee.name}
                        </h4>
                        <p className="text-xs font-mono text-primary-700">
                          UHID: {patientData.employee.uid} • Emp ID: {patientData.employee.employeeId}
                        </p>
                      </div>
                      <Badge variant={patientData.openVisit ? 'danger' : 'success'}>
                        {patientData.openVisit ? 'Active Open Visit' : 'Ready for Visit'}
                      </Badge>
                    </div>

                    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                            Visit Type
                          </label>
                          <select
                            value={visitType}
                            onChange={(e) => setVisitType(e.target.value as 'OPD' | 'IPD')}
                            className="input text-xs py-2 font-semibold"
                          >
                            <option value="OPD">OPD (Outpatient)</option>
                            <option value="IPD">IPD (Inpatient)</option>
                          </select>
                        </div>
                        {visitType === 'OPD' && (
                          <div>
                            <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1">
                              Department
                            </label>
                            <select
                              value={selectedDeptId}
                              onChange={(e) => setSelectedDeptId(e.target.value)}
                              className="input text-xs py-2"
                            >
                              {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                  {dept.name} ({dept.code})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => handleCreateVisit(false)}
                            disabled={creatingVisit}
                            className="btn btn-primary btn-md w-full gap-2"
                          >
                            <Ticket className="w-4 h-4" />
                            {creatingVisit ? 'Creating...' : 'Issue Visit Token'}
                          </button>
                        </div>
                      </div>

                      {openVisitWarning && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
                          <p className="font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            Patient already has an active open visit ({openVisitWarning.openVisit?.id}
                            ).
                          </p>
                          <button
                            type="button"
                            onClick={() => handleCreateVisit(true)}
                            className="btn btn-warning btn-sm"
                          >
                            Override & Force Create Visit
                          </button>
                        </div>
                      )}

                      {visitSuccessMessage && (
                        <div className="alert alert-success text-xs">{visitSuccessMessage}</div>
                      )}
                    </div>
                  </div>
                )}

                {patientData && (
                  <div className="pt-2">
                    <PatientWorkspace
                      patientData={patientData}
                      filterVisitType={filterVisitType}
                      filterAfter={
                        filterYear && filterMonth && filterDay
                          ? `${filterYear}-${filterMonth}-${filterDay}`
                          : filterYear && filterMonth
                            ? `${filterYear}-${filterMonth}-01`
                            : filterYear
                              ? `${filterYear}-01-01`
                              : undefined
                      }
                      filterBefore={
                        filterYear && filterMonth && filterDay
                          ? `${filterYear}-${filterMonth}-${filterDay}`
                          : filterYear && filterMonth
                            ? `${filterYear}-${filterMonth}-31`
                            : filterYear
                              ? `${filterYear}-12-31`
                              : undefined
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {/* WORKFLOW: Registration / Visit Success View */}
            {activeWorkflow === 'success-slip' && registrationResult?.employee && (
              <div className="card p-6 space-y-6 animate-fade-in">
                <div className="alert alert-success flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
                    <div>
                      <span className="font-bold text-sm block">
                        Registration Successful! Hospital UID Issued.
                      </span>
                      <span className="text-xs">
                        UHID: {registrationResult.hospitalUid?.uidCode}
                        {issuedToken ? ` • Token: ${issuedToken}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setActivePrintView('slip');
                        setTimeout(() => window.print(), 100);
                      }}
                      className="btn btn-secondary btn-sm gap-1.5"
                    >
                      <Printer className="w-4 h-4" /> Print Registration Slip
                    </button>
                    {passData && (
                      <button
                        onClick={() => {
                          setActivePrintView('pass');
                          setTimeout(() => window.print(), 100);
                        }}
                        className="btn btn-primary btn-sm gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                      >
                        <CreditCard className="w-4 h-4" /> Print Patient Pass
                      </button>
                    )}
                  </div>
                </div>

                {/* View Switcher Tabs */}
                <div className="flex border-b border-[var(--color-border)] gap-4 text-xs font-semibold">
                  <button
                    onClick={() => setActivePrintView('slip')}
                    className={`pb-2 border-b-2 transition-colors ${
                      activePrintView === 'slip'
                        ? 'border-primary-600 text-primary-600 font-bold'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:text-primary-600'
                    }`}
                  >
                    📄 Patient Registration Slip
                  </button>
                  {passData && (
                    <button
                      onClick={() => setActivePrintView('pass')}
                      className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
                        activePrintView === 'pass'
                          ? 'border-indigo-600 text-indigo-600 font-bold'
                          : 'border-transparent text-[var(--color-text-secondary)] hover:text-indigo-600'
                      }`}
                    >
                      <span>🎫 Patient Pass</span>
                      <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded font-mono">
                        Expires {passData.validityLabel}
                      </span>
                    </button>
                  )}
                </div>

                {/* Display active view */}
                {activePrintView === 'slip' ? (
                  <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-4">
                    <div className="slip-header-container border-b pb-3">
                      <div className="slip-header-text">
                        <h3 className="font-bold text-sm text-[var(--color-text-primary)]">
                          {hospitalName} — REGISTRATION SLIP
                        </h3>
                        <p className="text-[11px] text-[var(--color-text-secondary)]">
                          Ministry of Labour & Employment, Govt. of India
                        </p>
                        {issuedToken && (
                          <Badge variant="info" className="font-mono text-xs mt-1.5">
                            {issuedToken}
                          </Badge>
                        )}
                      </div>
                      <div className="slip-photo-box text-xs">
                        {registrationResult.patientProfile?.photoUrl || registrationResult.employee.patientProfile?.photoUrl || photoUrl ? (
                          <img
                            src={registrationResult.patientProfile?.photoUrl || registrationResult.employee.patientProfile?.photoUrl || photoUrl}
                            alt="Patient"
                            className="slip-photo"
                          />
                        ) : (
                          <div className="slip-photo-placeholder">Photo Not Available</div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">Patient Name:</span>{' '}
                        <span className="font-bold text-sm">{registrationResult.employee.name}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">Hospital UHID:</span>{' '}
                        <span className="font-mono font-bold text-sm text-primary-600">
                          {registrationResult.hospitalUid?.uidCode}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">Department:</span>{' '}
                        <span className="font-semibold">{registrationResult.employee.department}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-secondary)] block">
                          Employment Type:
                        </span>{' '}
                        <span className="font-semibold">
                          {registrationResult.employee.employmentType.name}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : passData ? (
                  <div className="p-5 rounded-xl border border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-4">
                    <div className="flex items-center justify-between border-b border-indigo-200 pb-3">
                      <div>
                        <h3 className="font-bold text-sm text-indigo-950 dark:text-indigo-200 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-indigo-600" />
                          OFFICIAL PATIENT PASS
                        </h3>
                        <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                          Authorized Hospital Gate &amp; Department Access Pass
                        </p>
                      </div>
                      <Badge variant="warning" className="font-mono text-xs">
                        VALIDITY: {passData.validityLabel.toUpperCase()}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-500 block">Pass ID:</span>
                        <span className="font-mono font-bold text-indigo-950 dark:text-indigo-200">{passData.passId}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Patient Name:</span>
                        <span className="font-bold text-indigo-950 dark:text-indigo-200 text-sm">{passData.patientName}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Hospital UHID:</span>
                        <span className="font-mono font-bold text-primary-600">{passData.uidCode}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Department:</span>
                        <span className="font-semibold">{passData.department}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Employment Type:</span>
                        <span className="font-semibold">{passData.employmentType}</span>
                      </div>
                    </div>

                    <div className="p-3 bg-indigo-100/80 dark:bg-indigo-900/50 rounded-lg text-xs flex justify-between items-center font-mono border border-indigo-200">
                      <div>
                        <span className="text-gray-600 block text-[10px]">Issued Date:</span>
                        <span className="font-bold text-indigo-950 dark:text-indigo-200">{passData.issueDate}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-amber-800 dark:text-amber-300 font-bold block text-[10px]">Expiry Date ({passData.validityLabel}):</span>
                        <span className="font-bold text-amber-900 dark:text-amber-200 text-sm">{passData.expiryDate}</span>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => {
                      resetVerificationState();
                      setEmployeeIdInput('');
                      setActiveWorkflow('esic-beneficiary');
                    }}
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

          {/* RIGHT COLUMN: Patient Context Preview & Live Queue */}
          <div className="lg:col-span-3 space-y-4">
            <div className="card p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border)] pb-2">
                Patient Profile Preview
              </h3>

              {previewEmployee ? (
                <>
                  <div className="flex items-center gap-3">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={previewEmployee.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-primary-500 shadow-sm flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center font-bold text-primary-600 text-sm flex-shrink-0">
                        {previewEmployee.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-[var(--color-text-primary)] truncate">
                        {previewEmployee.name}
                      </h4>
                      <p className="text-[11px] font-mono text-primary-600 truncate">
                        {'uid' in previewEmployee ? previewEmployee.uid : previewEmployee.employeeId}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs border-t border-[var(--color-border)] pt-2.5">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-secondary)]">Department:</span>
                      <span className="font-semibold">{previewEmployee.department}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--color-text-tertiary)] py-2">
                  No patient loaded yet. Verify or search for a patient to preview their record here.
                </p>
              )}
            </div>

            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Live OPD Queue
                </h3>
                <span className="text-[10px] text-primary-600 font-mono">Auto-sync 5s</span>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {liveQueue.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] py-2">
                    No patients currently in queue.
                  </p>
                ) : (
                  liveQueue.map((q) => (
                    <div
                      key={q.id}
                      className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-primary-600 block">
                          {q.tokenNumber}
                        </span>
                        <span className="text-[11px] text-[var(--color-text-primary)] font-medium truncate block max-w-[110px]">
                          {q.visit?.employee?.name || 'Patient'}
                        </span>
                      </div>
                      <Badge variant={q.calledAt ? 'success' : 'warning'}>
                        {q.calledAt ? 'CALLED' : 'WAITING'}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCameraModal && (
        <CameraCaptureModal
          onCapture={(dataUrl) => {
            setPhotoUrl(dataUrl);
            setShowCameraModal(false);
          }}
          onClose={() => setShowCameraModal(false)}
        />
      )}
    </div>
  );
};

/**
 * Direct camera patient photo capture (Feature 10) — a live video preview
 * with a single Capture button that snapshots the current frame to a data
 * URL, the same shape the file-upload path already produces, so it feeds
 * straight into the existing `photoUrl` state and registration payload.
 */
const CameraCaptureModal: React.FC<{ onCapture: (dataUrl: string) => void; onClose: () => void }> = ({
  onCapture,
  onClose,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Could not access the camera. Check browser permissions and try again.'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <CameraIcon className="w-4 h-4 text-emerald-600" /> Capture Patient Photo
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {error ? (
            <p className="text-sm text-red-600 text-center py-8">{error}</p>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black aspect-[4/3]" />
          )}
          <button
            type="button"
            onClick={handleCapture}
            disabled={!!error}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <CameraIcon className="w-4 h-4" /> Capture Photo
          </button>
        </div>
      </div>
    </div>
  );
};
