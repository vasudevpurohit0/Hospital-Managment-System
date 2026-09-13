import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LABOUR_DEPT_CLIENT, LabourDeptClient } from '../employee/adapters/labour-dept.client';
import { HospitalUidGeneratorService } from '../employee/services/hospital-uid-generator.service';
import { QrCodeService } from '../employee/services/qr-code.service';
import { OpdTokenGeneratorService } from '../opd/services/opd-token-generator.service';
import { ChargeService } from '../billing/charge.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import {
  RegisterPatientDto,
  VerifyEmployeeDto,
  CreatePatientVisitDto,
  PatientSearchQueryDto,
  UpdatePatientProfileDto,
} from './dto/patient-register.dto';
import { EmploymentTypeCode, VisitType, VisitStatus, Prisma } from '@prisma/client';

/** Kept identical to OpdService's — one consultation charge, wherever an OPD visit is created. */
const OPD_CONSULTATION_SERVICE_CODE = 'CONSULT-GEN';

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(LABOUR_DEPT_CLIENT) private labourDeptClient: LabourDeptClient,
    private uidGenerator: HospitalUidGeneratorService,
    private qrService: QrCodeService,
    private opdTokenGenerator: OpdTokenGeneratorService,
    private chargeService: ChargeService,
    private benefitRuleService: BenefitRuleService,
    private sequences: DocumentSequenceService,
  ) {}

  /**
   * 1. Verify Employee against Labour Department & check registration status
   */
  async verifyEmployee(dto: VerifyEmployeeDto) {
    const trimmedId = dto.employeeId.trim();
    if (!trimmedId) {
      throw new BadRequestException('Employee ID is required');
    }

    const verified = await this.labourDeptClient.verifyEmployee(trimmedId);
    if (!verified) {
      return {
        status: 'UNVERIFIED',
        message: 'Employee ID not found in Labour Department database',
        verifiedData: null,
      };
    }

    // Check if employee is already registered in Hospital DB
    const existingEmp = await this.prisma.employee.findUnique({
      where: { employeeId: trimmedId },
      include: {
        hospitalUid: true,
        patientProfile: true,
        employmentType: true,
      },
    });

    return {
      status: 'VERIFIED',
      verifiedData: verified,
      existingPatient: existingEmp
        ? {
            id: existingEmp.id,
            employeeId: existingEmp.employeeId,
            name: existingEmp.name,
            hospitalUid: existingEmp.hospitalUid?.uidCode || null,
            registeredAt: existingEmp.registrationDate,
          }
        : null,
    };
  }

  /**
   * 2. First-Time Patient Registration (Atomic Transaction & UID Generation)
   */
  async registerPatient(dto: RegisterPatientDto, actorUserId?: string) {
    const trimmedId = dto.employeeId.trim();

    // Check double submission
    const existingEmp = await this.prisma.employee.findUnique({
      where: { employeeId: trimmedId },
      include: { hospitalUid: true },
    });

    if (existingEmp && existingEmp.hospitalUid) {
      throw new ConflictException({
        message: `Employee ID ${trimmedId} is already registered with Hospital UID ${existingEmp.hospitalUid.uidCode}`,
        uidCode: existingEmp.hospitalUid.uidCode,
        status: 'ALREADY_REGISTERED',
      });
    }

    // Verify with Labour Department
    const verified = await this.labourDeptClient.verifyEmployee(trimmedId);
    if (!verified) {
      const escalation = await this.prisma.manualVerificationCase.create({
        data: {
          employeeId: trimmedId,
          reason: 'Employee ID verification failed against Labour Department source',
          status: 'PENDING',
          createdBy: actorUserId || null,
        },
      });

      return {
        status: 'MANUAL_VERIFICATION_PENDING',
        caseId: escalation.id,
        reason: 'Verification failed against Labour Department API. Escalated for manual review.',
      };
    }

    // Generate permanent Hospital UID and QR Code Payload
    const uidCode = await this.uidGenerator.generateUid();
    const qrDataUrl = await this.qrService.generateQrDataUrl(uidCode);

    // Atomic Prisma Transaction
    return await this.prisma.$transaction(async (tx) => {
      let post = await tx.post.findUnique({ where: { title: verified.postTitle } });
      if (!post) {
        post = await tx.post.create({ data: { title: verified.postTitle } });
      }

      let grade = await tx.grade.findFirst({ where: { payLevel: verified.gradePayLevel } });
      if (!grade) {
        grade = await tx.grade.create({
          data: { payLevel: verified.gradePayLevel, postId: post.id },
        });
      }

      const empTypeCode =
        verified.employmentTypeCode === 'CONTRACTUAL'
          ? EmploymentTypeCode.CONTRACTUAL
          : EmploymentTypeCode.PERMANENT;

      let empType = await tx.employmentType.findUnique({ where: { code: empTypeCode } });
      if (!empType) {
        empType = await tx.employmentType.create({
          data: { code: empTypeCode, name: `${empTypeCode} Employee` },
        });
      }

      const employee = await tx.employee.create({
        data: {
          employeeId: trimmedId,
          name: verified.name,
          department: verified.department,
          postId: post.id,
          gradeId: grade.id,
          employmentTypeId: empType.id,
          contactPhone: dto.contactPhone || verified.contactPhone || null,
          contactEmail: dto.contactEmail || verified.contactEmail || null,
        },
        include: {
          post: true,
          grade: true,
          employmentType: true,
        },
      });

      const patientProfile = await tx.patientProfile.create({
        data: {
          employeeId: employee.id,
          eligibilityCategory: dto.eligibilityCategory || (empTypeCode === EmploymentTypeCode.CONTRACTUAL ? 'CONTRACTUAL' : 'C'),
          dob: dto.dob ? new Date(dto.dob) : null,
          gender: dto.gender || null,
          address: dto.address || null,
          allergies: dto.allergies || null,
          chronicDiseases: dto.chronicDiseases || null,
          bloodGroup: dto.bloodGroup || null,
          photoUrl: dto.photoUrl || null,
          notes: dto.notes || null,
        },
      });

      const hospitalUid = await tx.hospitalUID.create({
        data: {
          uidCode,
          employeeId: employee.id,
          qrPayload: qrDataUrl,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId || null,
          actorRole: 'System/Registration',
          action: 'patient.register',
          entityType: 'Patient',
          entityId: employee.id,
          afterSnapshot: {
            uidCode,
            employeeId: trimmedId,
            name: verified.name,
          },
        },
      });

      return {
        status: 'REGISTERED',
        employee,
        patientProfile,
        hospitalUid,
        qrDataUrl,
      };
    });
  }

  /**
   * 3. Lookup Patient by Hospital UID
   */
  async getPatientByUid(uidCode: string) {
    const trimmed = uidCode.trim();

    const uidRecord = await this.prisma.hospitalUID.findFirst({
      where: {
        OR: [{ uidCode: trimmed }, { uidCode: { equals: trimmed, mode: 'insensitive' } }],
      },
      include: {
        employee: {
          include: {
            post: true,
            grade: true,
            employmentType: true,
            patientProfile: true,
            visits: {
              orderBy: { createdAt: 'desc' },
              include: {
                opdVisit: { include: { department: true } },
                admissions: { orderBy: { requestedAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!uidRecord) {
      throw new NotFoundException(`Patient with Hospital UID '${trimmed}' not found`);
    }

    return this.formatPatientProfileResponse(uidRecord.employee, uidRecord);
  }

  /**
   * 4. Lookup Patient by ESIC Employee ID
   */
  async getPatientByEmployeeId(employeeId: string) {
    const trimmed = employeeId.trim();

    const employee = await this.prisma.employee.findUnique({
      where: { employeeId: trimmed },
      include: {
        post: true,
        grade: true,
        employmentType: true,
        patientProfile: true,
        hospitalUid: true,
        visits: {
          orderBy: { createdAt: 'desc' },
          include: {
            opdVisit: { include: { department: true } },
            admissions: { orderBy: { requestedAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Patient with Employee ID '${trimmed}' not found`);
    }

    return this.formatPatientProfileResponse(employee, employee.hospitalUid);
  }

  /**
   * 5. Patient Search with Filters & Pagination
   */
  async searchPatients(queryDto: PatientSearchQueryDto) {
    const { query, department, employmentType, status, registrationDate, page = 1, limit = 20 } = queryDto;

    const whereClause: any = {
      hospitalUid: { isNot: null }
    };

    if (query && query.trim()) {
      const q = query.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

      // Feature 11: the same permanent patient must be discoverable through
      // every identifier the hospital issues — name, UHID, Employee ID,
      // mobile, OPD/IPD/Lab/Receipt number, queue token, or a raw record id —
      // never by creating a second record under a different one. Every
      // branch here resolves back to Employee, so there is no code path that
      // could turn a search hit into a new patient.
      whereClause.OR = [
        { employeeId: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { contactPhone: { contains: q, mode: 'insensitive' } },
        { hospitalUid: { uidCode: { contains: q, mode: 'insensitive' } } },
        { visits: { some: { opdVisit: { opdNumber: { equals: q, mode: 'insensitive' } } } } },
        { visits: { some: { opdVisit: { tokenNumber: { equals: q, mode: 'insensitive' } } } } },
        { visits: { some: { admissions: { some: { admissionNumber: { equals: q, mode: 'insensitive' } } } } } },
        { visits: { some: { labOrders: { some: { labNumber: { equals: q, mode: 'insensitive' } } } } } },
        { visits: { some: { chargeItems: { some: { receipt: { receiptNumber: { equals: q, mode: 'insensitive' } } } } } } },
        ...(isUuid
          ? [{ id: q }, { visits: { some: { id: q } } }]
          : []),
      ];
    }

    if (department) {
      whereClause.department = { contains: department, mode: 'insensitive' };
    }

    if (employmentType) {
      whereClause.employmentType = { code: employmentType.toUpperCase() as EmploymentTypeCode };
    }

    if (registrationDate) {
      const date = new Date(registrationDate);
      if (!isNaN(date.getTime())) {
        const startOfDay = new Date(date.setHours(0, 0, 0, 0));
        const endOfDay = new Date(date.setHours(23, 59, 59, 999));
        whereClause.registrationDate = { gte: startOfDay, lte: endOfDay };
      }
    }

    // Filter by Current Status
    if (status) {
      const s = status.toLowerCase();
      if (s === 'admitted') {
        whereClause.visits = {
          some: {
            status: VisitStatus.OPEN,
            type: VisitType.IPD,
          },
        };
      } else if (s === 'waiting') {
        whereClause.visits = {
          some: {
            status: VisitStatus.OPEN,
            type: VisitType.OPD,
            opdVisit: { calledAt: null },
          },
        };
      } else if (s === 'opd') {
        whereClause.visits = {
          some: {
            status: VisitStatus.OPEN,
            type: VisitType.OPD,
            opdVisit: { calledAt: { not: null } },
          },
        };
      } else if (s === 'discharged') {
        whereClause.visits = {
          some: {
            status: VisitStatus.CLOSED,
          },
        };
      }
    }

    const skip = (page - 1) * limit;

    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where: whereClause }),
      this.prisma.employee.findMany({
        where: whereClause,
        include: {
          post: true,
          grade: true,
          employmentType: true,
          patientProfile: true,
          hospitalUid: true,
          visits: {
            orderBy: { createdAt: 'desc' },
            include: {
              opdVisit: { include: { department: true } },
              admissions: {
                orderBy: { requestedAt: 'desc' },
                include: { ward: true, bed: true, assignedDoctor: { include: { employee: true } } },
              },
            },
          },
        },
        orderBy: { registrationDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items = employees.map((emp) => {
      const profile = (emp.patientProfile || {}) as any;
      const visits = emp.visits || [];
      const lastVisit = visits[0] || null;
      
      // Determine Current Status, Doctor, Bed & Ward
      let currentStatus = 'Discharged';
      let assignedDoctor = '—';
      let bedNumber = '—';
      let ward = '—';

      const activeAdmission = visits
        .flatMap((v) => v.admissions || [])
        .find((a) => a.status !== 'DISCHARGED');

      const openOpdVisit = visits.find((v) => v.status === VisitStatus.OPEN && v.type === VisitType.OPD);

      if (activeAdmission) {
        currentStatus = 'Admitted';
        ward = activeAdmission.ward?.name || 'General Ward';
        bedNumber = activeAdmission.bed?.bedNumber || '—';
        assignedDoctor = activeAdmission.assignedDoctor?.employee?.name || 'Attending Physician';
      } else if (openOpdVisit) {
        if (!openOpdVisit.opdVisit?.calledAt) {
          currentStatus = 'Waiting';
        } else {
          currentStatus = 'OPD';
        }
      } else if (lastVisit && lastVisit.status === VisitStatus.OPEN) {
        currentStatus = 'OPD';
      }

      // Calculate Age
      let ageStr = '—';
      if (profile.dob) {
        const birthDate = new Date(profile.dob);
        const today = new Date();
        let ageVal = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          ageVal--;
        }
        ageStr = `${ageVal} Yrs`;
      }

      return {
        id: emp.id,
        hospitalUid: emp.hospitalUid?.uidCode || '—',
        name: emp.name,
        employeeId: emp.employeeId,
        age: ageStr,
        gender: profile.gender || '—',
        mobile: emp.contactPhone || '—',
        department: emp.department || '—',
        currentStatus,
        assignedDoctor,
        bedNumber,
        ward,
        registrationDate: emp.registrationDate || emp.createdAt,
        lastVisit: lastVisit ? lastVisit.createdAt : null,
      };
    });

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 6. Create OPD/IPD/Emergency Visit
   */
  /**
   * 6. Create OPD/IPD/Emergency Visit
   */
  async createVisit(dto: CreatePatientVisitDto, actorUserId?: string) {
    const trimmedId = dto.employeeId.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId);
    const orConditions: any[] = [
      { employeeId: { equals: trimmedId, mode: 'insensitive' } },
      { hospitalUid: { uidCode: { equals: trimmedId, mode: 'insensitive' } } },
    ];
    if (isUuid) {
      orConditions.push({ id: trimmedId });
    }

    // Find Employee record by employeeId, database UUID, or Hospital UID
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: orConditions,
      },
      include: {
        hospitalUid: true,
        patientProfile: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Patient matching identifier '${trimmedId}' not found`);
    }

    // Check for open active visit
    const openVisit = await this.prisma.visit.findFirst({
      where: {
        employeeId: employee.id,
        status: VisitStatus.OPEN,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (openVisit && !dto.ignoreOpenVisitWarning) {
      return {
        status: 'OPEN_VISIT_WARNING',
        visit: openVisit,
        openVisit,
        message: `Patient already has an active open visit (${openVisit.id}). Override with ignoreOpenVisitWarning=true to force create.`,
      };
    }

    // Atomic Visit Creation
    return await this.prisma.$transaction(async (tx) => {
      const visit = await tx.visit.create({
        data: {
          employeeId: employee.id,
          type: dto.type,
          status: VisitStatus.OPEN,
        },
      });

      let opdVisitRecord: any = null;
      let tokenNumber: string | null = null;
      const isDirectTherapyVisit = dto.type === VisitType.OPD && dto.visitPurpose === 'THERAPY';

      // A Direct-Therapy registration (Feature: Therapy entry point 1) opens
      // a bare visit only — no OPD token, no queue entry, no consultation
      // charge. That absence of an OPDVisit row is exactly what lets
      // TherapyService derive this later as a DIRECT-source booking rather
      // than an OPD one.
      if (dto.type === VisitType.OPD && !isDirectTherapyVisit) {
        let deptId = dto.departmentId;
        let deptCode = 'GENMED';

        if (!deptId) {
          const firstDept = await tx.department.findFirst();
          if (!firstDept) {
            const newDept = await tx.department.create({
              data: { name: 'General Medicine', code: 'GENMED' },
            });
            deptId = newDept.id;
            deptCode = newDept.code;
          } else {
            deptId = firstDept.id;
            deptCode = firstDept.code;
          }
        } else {
          const dept = await tx.department.findUnique({ where: { id: deptId } });
          if (dept) {
            deptCode = dept.code;
          }
        }

        // Allocate inside the caller's transaction so a failed visit creation
        // releases the token rather than leaving a gap in the day's numbering.
        const generatedToken = await this.opdTokenGenerator.generateDailyToken(deptCode, tx);
        tokenNumber = generatedToken;

        // Permanent OPD number, distinct from the daily queue token — kept
        // identical to OpdService.createOpdVisit.
        const opdNumber = await this.sequences.next('OPD_NUMBER', tx);

        opdVisitRecord = await tx.oPDVisit.create({
          data: {
            visitId: visit.id,
            departmentId: deptId,
            tokenNumber: generatedToken,
            opdNumber,
          },
          include: { department: true },
        });

        // Best-effort, identical to OpdService.createOpdVisit: CONSULT-GEN has
        // no rate until an administrator sets one, so this quietly skips
        // rather than blocking visit creation.
        const consultationService = await tx.service.findUnique({
          where: { code: OPD_CONSULTATION_SERVICE_CODE },
        });
        if (consultationService) {
          const empType = employee.employmentTypeId
            ? await tx.employmentType.findUnique({ where: { id: employee.employmentTypeId } })
            : null;
          const outcome = await this.benefitRuleService.evaluate(empType?.code ?? 'PERMANENT');
          await this.chargeService.postServiceChargeIfPriced(
            { visitId: visit.id, serviceId: consultationService.id },
            outcome,
            tx,
          );
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId || null,
          actorRole: 'Staff/Visit',
          action: 'visit.create',
          entityType: 'Visit',
          entityId: visit.id,
          afterSnapshot: {
            employeeId: employee.employeeId,
            visitType: dto.type,
            visitPurpose: dto.visitPurpose ?? 'OPD_CONSULTATION',
            tokenNumber,
          },
        },
      });

      return {
        status: 'CREATED',
        visit,
        opdVisit: opdVisitRecord,
        tokenNumber,
        visitPurpose: isDirectTherapyVisit ? 'THERAPY' : 'OPD_CONSULTATION',
      };
    });
  }

  /**
   * 7. Fetch Complete Medical History (Longitudinal Record)
   */
  async getPatientMedicalHistory(identifier: string) {
    const trimmed = identifier.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const orConditions: any[] = [
      { employeeId: { equals: trimmed, mode: 'insensitive' } },
      { hospitalUid: { uidCode: { equals: trimmed, mode: 'insensitive' } } },
    ];
    if (isUuid) {
      orConditions.push({ id: trimmed });
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: orConditions,
      },
      include: {
        post: true,
        grade: true,
        employmentType: true,
        patientProfile: true,
        hospitalUid: true,
        visits: {
          orderBy: { createdAt: 'desc' },
          include: {
            opdVisit: { include: { department: true } },
            diagnoses: { orderBy: { createdAt: 'desc' } },
            prescriptions: {
              orderBy: { createdAt: 'desc' },
              include: {
                items: true,
              },
            },
            labOrders: {
              orderBy: { createdAt: 'desc' },
              include: {
                items: { include: { labTest: { select: { name: true, code: true } } } },
                report: { select: { releasedAt: true, verifiedById: true } },
              },
            },
            therapySessions: {
              orderBy: { scheduledAt: 'desc' },
              include: { service: { select: { name: true, code: true } } },
            },
            therapyCourses: {
              orderBy: { startedAt: 'desc' },
              include: { service: { select: { name: true, code: true } } },
            },
            chargeItems: {
              orderBy: { createdAt: 'desc' },
              include: { receipt: { select: { receiptNumber: true } } },
            },
            admissions: {
              orderBy: { requestedAt: 'desc' },
              include: {
                ward: true,
                room: true,
                bed: true,
                notes: { orderBy: { createdAt: 'desc' } },
                dischargeSummary: true,
                locationHistory: { orderBy: { movedAt: 'desc' } },
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Patient matching '${trimmed}' not found`);
    }

    const patientInfo = this.formatPatientProfileResponse(employee, employee.hospitalUid);

    // Aggregate clinical + financial timeline history, per visit. Every
    // module here (lab, therapy, billing, admission) hangs off Visit and
    // nothing else — the same structural rule that makes duplicate patients
    // impossible (Feature 20/21) also guarantees this one query surfaces
    // everything Feature 5 asks for: clinical AND financial, connected by
    // the one permanent UHID.
    const timeline = employee.visits.map((v) => {
      const grossAmount = v.chargeItems.reduce((a, c) => a.add(c.grossAmount), new Prisma.Decimal(0));
      const netAmount = v.chargeItems.reduce((a, c) => a.add(c.netAmount), new Prisma.Decimal(0));
      const outstandingAmount = v.chargeItems
        .filter((c) => c.status === 'PENDING')
        .reduce((a, c) => a.add(c.netAmount), new Prisma.Decimal(0));

      return {
        visitId: v.id,
        date: v.createdAt,
        type: v.type,
        status: v.status,
        closedAt: v.closedAt,
        department: v.opdVisit?.department?.name || 'General Medicine',
        opdNumber: v.opdVisit?.opdNumber ?? null,
        tokenNumber: v.opdVisit?.tokenNumber || null,
        diagnoses: v.diagnoses,
        prescriptions: v.prescriptions,
        labOrders: v.labOrders.map((lo) => ({
          id: lo.id,
          labNumber: lo.labNumber,
          status: lo.status,
          priority: lo.priority,
          tests: lo.items.map((i) => ({ name: i.labTest.name, code: i.labTest.code, status: i.status })),
          reportReleasedAt: lo.report?.releasedAt ?? null,
        })),
        therapySessions: v.therapySessions.map((s) => ({
          id: s.id,
          service: s.service.name,
          status: s.status,
          scheduledAt: s.scheduledAt,
          performedAt: s.performedAt,
        })),
        therapyCourses: v.therapyCourses.map((c) => ({
          id: c.id,
          service: c.service.name,
          status: c.status,
          plannedSessions: c.plannedSessions,
        })),
        admissions: v.admissions.map((a) => ({
          ...a,
          admissionNumber: a.admissionNumber,
          locationTrail: a.locationHistory,
        })),
        financials: {
          grossAmount: grossAmount.toString(),
          netAmount: netAmount.toString(),
          outstandingAmount: outstandingAmount.toString(),
          chargeCount: v.chargeItems.length,
        },
      };
    });

    return {
      patient: patientInfo,
      summary: {
        totalVisits: employee.visits.length,
        totalDiagnoses: employee.visits.reduce((acc, v) => acc + v.diagnoses.length, 0),
        totalPrescriptions: employee.visits.reduce((acc, v) => acc + v.prescriptions.length, 0),
        totalAdmissions: employee.visits.reduce((acc, v) => acc + v.admissions.length, 0),
        totalLabOrders: employee.visits.reduce((acc, v) => acc + v.labOrders.length, 0),
        totalTherapySessions: employee.visits.reduce((acc, v) => acc + v.therapySessions.length, 0),
      },
      timeline,
    };
  }

  /**
   * 8. Update Patient Profile
   */
  async updatePatientProfile(
    idOrEmployeeId: string,
    dto: UpdatePatientProfileDto,
    actorUserId?: string,
  ) {
    const trimmed = idOrEmployeeId.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const orConditions: any[] = [
      { employeeId: { equals: trimmed, mode: 'insensitive' } },
      { hospitalUid: { uidCode: { equals: trimmed, mode: 'insensitive' } } },
    ];
    if (isUuid) {
      orConditions.push({ id: trimmed });
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: orConditions,
      },
      include: {
        patientProfile: true,
        hospitalUid: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Patient matching '${trimmed}' not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update Employee contact info if provided
      if (dto.contactPhone !== undefined || dto.contactEmail !== undefined) {
        await tx.employee.update({
          where: { id: employee.id },
          data: {
            ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
            ...(dto.contactEmail !== undefined && { contactEmail: dto.contactEmail }),
          },
        });
      }

      // Update PatientProfile medical/demographic info
      let profile = employee.patientProfile;
      if (!profile) {
        profile = await tx.patientProfile.create({
          data: {
            employeeId: employee.id,
            eligibilityCategory: dto.eligibilityCategory || 'C',
          },
        });
      }

      const updatedProfile = await tx.patientProfile.update({
        where: { id: profile.id },
        data: {
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.dob !== undefined && { dob: dto.dob ? new Date(dto.dob) : null }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.allergies !== undefined && { allergies: dto.allergies }),
          ...(dto.chronicDiseases !== undefined && { chronicDiseases: dto.chronicDiseases }),
          ...(dto.bloodGroup !== undefined && { bloodGroup: dto.bloodGroup }),
          ...(dto.eligibilityCategory !== undefined && { eligibilityCategory: dto.eligibilityCategory }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId || null,
          actorRole: 'Staff/ProfileUpdate',
          action: 'patient.update',
          entityType: 'PatientProfile',
          entityId: updatedProfile.id,
          afterSnapshot: {
            employeeId: employee.employeeId,
            eligibilityCategory: updatedProfile.eligibilityCategory,
          },
        },
      });

      return updatedProfile;
    });

    return this.getPatientByEmployeeId(employee.employeeId);
  }

  async getPatientMasterRecord(id: string) {
    // 1. Fetch employee details with full relations
    const employee = (await this.prisma.employee.findUnique({
      where: { id },
      include: {
        post: true,
        grade: true,
        employmentType: true,
        patientProfile: true,
        hospitalUid: true,
      },
    })) as any;
    if (!employee) {
      throw new NotFoundException(`Patient not found`);
    }

    // 2. Fetch all visits — includes every clinical module (Feature 5), so the
    // timeline built below in buildTimelineEvents() is real and complete, not
    // reconstructed from a narrower query.
    const visits = (await this.prisma.visit.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        opdVisit: {
          include: { department: true },
        },
        diagnoses: true,
        labOrders: {
          include: {
            items: { include: { labTest: { select: { name: true, code: true } } } },
            report: { select: { releasedAt: true } },
          },
        },
        therapySessions: { include: { service: { select: { name: true } } } },
        therapyCourses: { include: { service: { select: { name: true } } } },
        prescriptions: {
          include: {
            items: true,
          },
        },
      },
    })) as any[];

    // 3. Fetch admissions
    const admissions = (await this.prisma.admission.findMany({
      where: { visit: { employeeId: id } },
      orderBy: { requestedAt: 'desc' },
      include: {
        ward: true,
        room: true,
        bed: true,
        dischargeSummary: true,
        assignedDoctor: { include: { employee: true } },
      },
    })) as any[];

    // 4. Fetch all users to map doctor names
    const users = await this.prisma.user.findMany({
      include: { employee: true },
    });
    const userMap = new Map(users.map(u => [u.id, u.employee?.name || u.identifier.split('@')[0]]));

    // 5. Build Personal Info
    const profile = (employee.patientProfile || {}) as any;
    const dob = profile.dob;
    let age = null;
    if (dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    const personalInfo = {
      uhid: employee.hospitalUid?.uidCode || '—',
      employeeId: employee.employeeId,
      name: employee.name,
      age: age !== null ? `${age} Yrs` : '—',
      gender: profile.gender || '—',
      dob: dob ? new Date(dob).toISOString().split('T')[0] : '—',
      mobile: employee.contactPhone || '—',
      address: profile.address || '—',
      employmentType: employee.employmentType?.name || '—',
      relation: 'Self',
      photoUrl: profile.photoUrl || null,
    };

    // 6. Build Visit History (OPD Visits)
    const visitHistory = visits
      .filter((v: any) => v.type === 'OPD')
      .map((v: any) => {
        const dx = v.diagnoses[0];
        const rx = v.prescriptions[0];
        const doctorName = dx ? userMap.get(dx.doctorId) : (rx ? userMap.get(rx.doctorId) : 'Attending Doctor');
        return {
          id: v.id,
          date: v.createdAt,
          department: v.opdVisit?.department?.name || 'General Medicine',
          doctor: doctorName || 'Attending Doctor',
          diagnosis: dx?.diagnosisText || '—',
          prescription: rx ? `${rx.items.length} Medicine(s)` : '—',
        };
      });

    // 7. Build Admission History
    const admissionHistory = admissions.map((a: any) => {
      const duration = a.dischargedAt && a.allocatedAt
        ? Math.ceil((new Date(a.dischargedAt).getTime() - new Date(a.allocatedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const visitRecord = visits.find((v: any) => v.id === a.visitId);
      const departmentName = visitRecord?.opdVisit?.department?.name || 'Inpatient Department (IPD)';

      return {
        id: a.id,
        admissionDate: a.allocatedAt || a.requestedAt,
        ward: a.ward?.name || 'General Ward',
        room: a.room?.roomNumber || '—',
        bed: a.bed?.bedNumber || '—',
        department: departmentName,
        treatingDoctor: a.assignedDoctor?.employee?.name || 'Attending Physician',
        dischargeDate: a.dischargedAt || null,
        lengthOfStay: duration !== null ? `${duration} Day(s)` : '—',
        status: a.status,
      };
    });

    // 8. Build Medicines
    const medicinesList: any[] = [];
    visits.forEach((v: any) => {
      v.prescriptions.forEach((p: any) => {
        p.items.forEach((item: any) => {
          const dispensedQty = item.dispensedQuantity || 0;

          medicinesList.push({
            id: item.id,
            name: item.medicineName || 'Medicine',
            brandName: '—',
            prescribedQty: item.dispensedQuantity || 0, // Fallback if no separate prescribed field is defined
            dispensedQty,
            status: item.dispenseStatus,
          });
        });
      });
    });

    // 9. Build Billing Summary — 100% real, sourced from the same charge
    // ledger Feature 3/4's Patient Ledger screen reads (ChargeService.
    // patientLedger). This used to be invented arithmetic
    // (visits.length * 150, labOrders.length * 200) plus a read of the
    // retired BillingTransaction table; neither ever agreed with what a
    // patient was actually billed or had actually paid. There is exactly one
    // billing computation in the system now, and every screen that shows a
    // rupee figure resolves it from here.
    const ledger = await this.chargeService.patientLedger(employee.employeeId);
    const categoryBucket = (categoryName: string): 'consultation' | 'pharmacy' | 'lab' | 'therapy' | 'other' => {
      if (categoryName === 'Consultation') return 'consultation';
      if (categoryName === 'Pharmacy') return 'pharmacy';
      if (['Roga Nidan (Pathology)', 'Urine Test', 'Sputum Test', 'Stool Test'].includes(categoryName)) return 'lab';
      if (['Panchakarma & Ayurvedic Therapy', 'Yoga & Naturopathy'].includes(categoryName)) return 'therapy';
      return 'other';
    };

    const bucketTotals = { consultation: 0, pharmacy: 0, lab: 0, therapy: 0, other: 0 };
    for (const txn of ledger.transactions) {
      bucketTotals[categoryBucket(txn.category)] += Number(txn.totalAmount);
    }

    const billingSummary = {
      consultation: bucketTotals.consultation,
      pharmacy: bucketTotals.pharmacy,
      lab: bucketTotals.lab,
      therapy: bucketTotals.therapy,
      other: bucketTotals.other,
      total: Number(ledger.summary.totalAmount),
      paid: Number(ledger.summary.paidAmount),
      pending: Number(ledger.summary.outstandingAmount),
    };
    const pendingAmount = billingSummary.pending;

    // 10. Build Medical Timeline (chronological events)
    const timelineEvents: any[] = [];
    
    timelineEvents.push({
      title: 'Patient Registered',
      description: 'Profile created in ESIC central directory',
      date: employee.registrationDate || employee.createdAt,
      type: 'registration',
    });

    visits.forEach((v: any) => {
      timelineEvents.push({
        title: `Visited OPD - ${v.opdVisit?.department?.name || 'General Medicine'}`,
        description: `Issued Daily Token: ${v.opdVisit?.tokenNumber || '—'}`,
        date: v.createdAt,
        type: 'opd-visit',
      });

      v.diagnoses.forEach((d: any) => {
        timelineEvents.push({
          title: 'OPD Clinical Consultation',
          description: `Diagnosed: ${d.diagnosisText}`,
          date: d.createdAt,
          type: 'consultation',
        });
      });

      v.prescriptions.forEach((p: any) => {
        timelineEvents.push({
          title: 'Medicine Prescribed',
          description: `Prescription signed by attending physician (${p.items.length} items)`,
          date: p.signedAt || p.createdAt,
          type: 'prescription',
        });

        // dispenseStatus is the real, currently-written field (Feature 3/4's
        // charge ledger drives it via PharmacyService) — BillingTransaction
        // stopped being written to after P2 and would always read false here.
        const hasDispensed = p.items.some(
          (item: any) => item.dispenseStatus === 'DISPENSED' || item.dispenseStatus === 'PARTIALLY_DISPENSED',
        );
        if (hasDispensed) {
          timelineEvents.push({
            title: 'Medicines Issued',
            description: 'Dispensed by central pharmacy counter',
            date: p.signedAt || p.createdAt,
            type: 'dispensation',
          });
        }
      });

      // Laboratory (Feature 6) — real orders and report releases, not a count.
      v.labOrders.forEach((lo: any) => {
        const testNames = lo.items.map((i: any) => i.labTest.name).join(', ') || 'Investigation';
        timelineEvents.push({
          title: `Lab Order ${lo.labNumber ?? ''}`.trim(),
          description: `${testNames} — ${lo.status.replace(/_/g, ' ')}`,
          date: lo.createdAt,
          type: 'lab-order',
        });
        if (lo.report?.releasedAt) {
          timelineEvents.push({
            title: 'Lab Report Released',
            description: `${lo.labNumber ?? 'Report'}: ${testNames}`,
            date: lo.report.releasedAt,
            type: 'lab-report',
          });
        }
      });

      // Therapy (Feature 1/7) — courses and individual sessions, tagged with
      // which of the three entry points opened them (Direct/OPD/IPD).
      v.therapyCourses.forEach((c: any) => {
        timelineEvents.push({
          title: `Therapy Course Opened — ${c.service.name}`,
          description: `${c.plannedSessions} session(s) planned, status ${c.status} · source: ${c.source}`,
          date: c.startedAt,
          type: 'therapy-course',
        });
      });
      v.therapySessions.forEach((s: any) => {
        if (s.status === 'SCHEDULED') return; // only report what actually happened
        timelineEvents.push({
          title: `Therapy Session — ${s.service.name}`,
          description: `Session #${s.sessionNumber} ${s.status.toLowerCase()} · source: ${s.source}`,
          date: s.performedAt ?? s.scheduledAt,
          type: 'therapy-session',
        });
      });
    });

    admissions.forEach((a: any) => {
      timelineEvents.push({
        title: 'Patient Admitted (IPD)',
        description: `Allocated to Ward: ${a.ward?.name || 'General Ward'}, Bed: ${a.bed?.bedNumber || '—'}`,
        date: a.allocatedAt || a.requestedAt,
        type: 'admission',
      });

      if (a.dischargedAt) {
        timelineEvents.push({
          title: 'Patient Discharged',
          description: `Discharge summary signed. Length of stay: ${a.dischargedAt && a.allocatedAt ? Math.ceil((new Date(a.dischargedAt).getTime() - new Date(a.allocatedAt).getTime()) / (1000 * 60 * 60 * 24)) : 0} days`,
          date: a.dischargedAt,
          type: 'discharge',
        });
      }
    });

    // Payments (Feature 3/4/15) — one event per receipt actually issued,
    // from the same ledger the billing summary above resolves.
    const receiptTotals = new Map<string, { amount: number; date: Date }>();
    for (const txn of ledger.transactions) {
      if (!txn.receiptNumber) continue;
      const existing = receiptTotals.get(txn.receiptNumber);
      const amount = (existing?.amount ?? 0) + Number(txn.totalAmount);
      receiptTotals.set(txn.receiptNumber, { amount, date: existing?.date ?? txn.date });
    }
    for (const [receiptNumber, { amount, date }] of receiptTotals) {
      timelineEvents.push({
        title: `Payment Received — ${receiptNumber}`,
        description: `₹${amount.toFixed(2)} collected`,
        date,
        type: 'payment',
      });
    }

    timelineEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const lastConsultationDate = visits.flatMap((v: any) => v.diagnoses).map((d: any) => d.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const currentAdmission = admissions.find((a: any) => a.status !== 'DISCHARGED') || null;

    const stats = {
      totalVisits: visits.length,
      totalAdmissions: admissions.length,
      currentAdmission: currentAdmission ? `${currentAdmission.ward?.name || 'IPD'} (Bed ${currentAdmission.bed?.bedNumber || '—'})` : 'None',
      lastConsultation: lastConsultationDate,
      pendingBills: Math.max(0, pendingAmount),
    };

    return {
      personalInfo,
      visitHistory,
      admissionHistory,
      medicines: medicinesList,
      billingSummary,
      timeline: timelineEvents,
      stats,
    };
  }

  /**
   * Private Helper: Format complete patient profile response
   */
  private formatPatientProfileResponse(employee: any, hospitalUid?: any) {
    const profile = employee.patientProfile || {};
    const visits = employee.visits || [];
    const openVisit = visits.find((v: any) => v.status === VisitStatus.OPEN) || null;
    const lastVisit = visits[0] || null;

    const activeAdmission =
      visits.flatMap((v: any) => v.admissions || []).find((a: any) => a.status !== 'DISCHARGED') ||
      null;

    return {
      id: employee.id,
      employeeId: employee.employeeId,
      hospitalUid: hospitalUid?.uidCode || null,
      qrDataUrl: hospitalUid?.qrPayload || null,
      name: employee.name,
      photoUrl: profile.photoUrl || null,
      department: employee.department,
      post: employee.post?.title || 'Officer',
      grade: employee.grade?.payLevel || 'Pay Level 4',
      employmentType: employee.employmentType?.code || 'PERMANENT',
      employmentTypeName: employee.employmentType?.name || 'Permanent Employee',
      contactPhone: employee.contactPhone || null,
      contactEmail: employee.contactEmail || null,
      registrationDate: employee.registrationDate,

      // Personal & Medical Profile
      personal: {
        dob: profile.dob || null,
        gender: profile.gender || null,
        address: profile.address || null,
      },
      medical: {
        eligibilityCategory: profile.eligibilityCategory || 'C',
        allergies: profile.allergies || null,
        chronicDiseases: profile.chronicDiseases || null,
        bloodGroup: profile.bloodGroup || null,
        notes: profile.notes || null,
      },

      // Statistics
      stats: {
        totalVisits: visits.length,
        openVisit: openVisit ? { id: openVisit.id, date: openVisit.createdAt, type: openVisit.type } : null,
        lastVisit: lastVisit ? { id: lastVisit.id, date: lastVisit.createdAt, type: lastVisit.type } : null,
        activeAdmission: activeAdmission ? { id: activeAdmission.id, status: activeAdmission.status } : null,
      },
    };
  }
}
