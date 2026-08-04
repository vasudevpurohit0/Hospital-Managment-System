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
import {
  RegisterPatientDto,
  VerifyEmployeeDto,
  CreatePatientVisitDto,
  PatientSearchQueryDto,
  UpdatePatientProfileDto,
} from './dto/patient-register.dto';
import { EmploymentTypeCode, VisitType, VisitStatus } from '@prisma/client';

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(LABOUR_DEPT_CLIENT) private labourDeptClient: LabourDeptClient,
    private uidGenerator: HospitalUidGeneratorService,
    private qrService: QrCodeService,
    private opdTokenGenerator: OpdTokenGeneratorService,
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
    const { query, department, employmentType, registrationDate, page = 1, limit = 20 } = queryDto;

    const whereClause: any = {};

    if (query && query.trim()) {
      const q = query.trim();
      whereClause.OR = [
        { employeeId: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { contactPhone: { contains: q, mode: 'insensitive' } },
        { hospitalUid: { uidCode: { contains: q, mode: 'insensitive' } } },
        { hospitalUid: { qrPayload: { contains: q, mode: 'insensitive' } } },
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
            take: 1,
            include: { opdVisit: true, admissions: true },
          },
        },
        orderBy: { registrationDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items = employees.map((emp) => this.formatPatientProfileResponse(emp, emp.hospitalUid));

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

      if (dto.type === VisitType.OPD) {
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

        const generatedToken = await this.opdTokenGenerator.generateDailyToken(deptCode);
        tokenNumber = generatedToken;

        opdVisitRecord = await tx.oPDVisit.create({
          data: {
            visitId: visit.id,
            departmentId: deptId,
            tokenNumber: generatedToken,
          },
          include: { department: true },
        });
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
            tokenNumber,
          },
        },
      });

      return {
        status: 'CREATED',
        visit,
        opdVisit: opdVisitRecord,
        tokenNumber,
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
                items: {
                  include: {
                    billingTransactions: true,
                  },
                },
              },
            },
            labOrders: { orderBy: { createdAt: 'desc' } },
            admissions: {
              orderBy: { requestedAt: 'desc' },
              include: {
                ward: true,
                room: true,
                bed: true,
                notes: { orderBy: { createdAt: 'desc' } },
                dischargeSummary: true,
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

    // Aggregate clinical timeline history
    const timeline = employee.visits.map((v) => ({
      visitId: v.id,
      date: v.createdAt,
      type: v.type,
      status: v.status,
      closedAt: v.closedAt,
      department: v.opdVisit?.department?.name || 'General Medicine',
      tokenNumber: v.opdVisit?.tokenNumber || null,
      diagnoses: v.diagnoses,
      prescriptions: v.prescriptions,
      labOrders: v.labOrders,
      admissions: v.admissions,
    }));

    return {
      patient: patientInfo,
      summary: {
        totalVisits: employee.visits.length,
        totalDiagnoses: employee.visits.reduce((acc, v) => acc + v.diagnoses.length, 0),
        totalPrescriptions: employee.visits.reduce((acc, v) => acc + v.prescriptions.length, 0),
        totalAdmissions: employee.visits.reduce((acc, v) => acc + v.admissions.length, 0),
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
