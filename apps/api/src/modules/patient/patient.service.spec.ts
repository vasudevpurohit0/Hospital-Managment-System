import { Test, TestingModule } from '@nestjs/testing';
import { PatientService } from './patient.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LABOUR_DEPT_CLIENT } from '../employee/adapters/labour-dept.client';
import { HospitalUidGeneratorService } from '../employee/services/hospital-uid-generator.service';
import { QrCodeService } from '../employee/services/qr-code.service';
import { OpdTokenGeneratorService } from '../opd/services/opd-token-generator.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { VisitType, VisitStatus, EmploymentTypeCode } from '@prisma/client';

describe('PatientService', () => {
  let service: PatientService;
  let prisma: any;
  let labourDeptClient: any;

  const mockEmployee = {
    id: 'emp-uuid-1',
    employeeId: 'EMP-1001',
    name: 'Rajesh Kumar',
    department: 'Public Works Department',
    postId: 'post-1',
    gradeId: 'grade-1',
    employmentTypeId: 'emp-type-1',
    contactPhone: '+91 9876543210',
    contactEmail: 'rajesh@labour.gov.in',
    registrationDate: new Date('2026-01-01'),
    post: { title: 'Clerk' },
    grade: { payLevel: 'Pay Level 4' },
    employmentType: { code: 'PERMANENT', name: 'Permanent Employee' },
    patientProfile: {
      eligibilityCategory: 'C',
      dob: new Date('1990-01-01'),
      gender: 'MALE',
      address: '123 Main St',
      allergies: 'Penicillin',
      chronicDiseases: 'None',
      bloodGroup: 'O+',
      notes: 'No specific notes',
    },
    hospitalUid: {
      uidCode: 'HSP00000001',
      qrPayload: 'data:image/png;base64,mockqr',
    },
    visits: [],
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      hospitalUID: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      patientProfile: {
        create: jest.fn(),
        update: jest.fn(),
      },
      post: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      grade: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      employmentType: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      manualVerificationCase: {
        create: jest.fn(),
      },
      visit: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      oPDVisit: {
        create: jest.fn(),
      },
      department: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };

    labourDeptClient = {
      verifyEmployee: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientService,
        { provide: PrismaService, useValue: prisma },
        { provide: LABOUR_DEPT_CLIENT, useValue: labourDeptClient },
        {
          provide: HospitalUidGeneratorService,
          useValue: { generateUid: jest.fn().mockResolvedValue('HSP00000001') },
        },
        {
          provide: QrCodeService,
          useValue: { generateQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,mockqr') },
        },
        {
          provide: OpdTokenGeneratorService,
          useValue: { generateDailyToken: jest.fn().mockResolvedValue('GENMED-001') },
        },
      ],
    }).compile();

    service = module.get<PatientService>(PatientService);
  });

  describe('1. Employee Verification', () => {
    it('should verify existing Labour Dept employee and return existing patient info if registered', async () => {
      labourDeptClient.verifyEmployee.mockResolvedValue({
        employeeId: 'EMP-1001',
        name: 'Rajesh Kumar',
        department: 'Public Works',
        postTitle: 'Clerk',
        gradePayLevel: 'Pay Level 4',
        employmentTypeCode: 'PERMANENT',
      });

      prisma.employee.findUnique.mockResolvedValue(mockEmployee);

      const result = await service.verifyEmployee({ employeeId: 'EMP-1001' });

      expect(result.status).toBe('VERIFIED');
      expect(result.verifiedData).toBeDefined();
      expect(result.existingPatient?.hospitalUid).toBe('HSP00000001');
    });

    it('should return UNVERIFIED for unknown employee IDs', async () => {
      labourDeptClient.verifyEmployee.mockResolvedValue(null);

      const result = await service.verifyEmployee({ employeeId: 'INVALID-999' });

      expect(result.status).toBe('UNVERIFIED');
      expect(result.verifiedData).toBeNull();
    });

    it('should throw BadRequestException if employeeId is empty', async () => {
      await expect(service.verifyEmployee({ employeeId: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('2. First-Time Patient Registration & UID Generation', () => {
    it('should successfully register a new patient, generate Hospital UID, and return QR payload', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      labourDeptClient.verifyEmployee.mockResolvedValue({
        employeeId: 'EMP-1004',
        name: 'Anita Verma',
        department: 'Education Dept',
        postTitle: 'Teacher',
        gradePayLevel: 'Pay Level 6',
        employmentTypeCode: 'PERMANENT',
      });

      prisma.post.findUnique.mockResolvedValue({ id: 'post-teacher', title: 'Teacher' });
      prisma.grade.findFirst.mockResolvedValue({ id: 'grade-6', payLevel: 'Pay Level 6' });
      prisma.employmentType.findUnique.mockResolvedValue({ id: 'emp-perm', code: 'PERMANENT' });
      prisma.employee.create.mockResolvedValue({ ...mockEmployee, id: 'emp-1004', employeeId: 'EMP-1004' });
      prisma.patientProfile.create.mockResolvedValue({ id: 'prof-1', employeeId: 'emp-1004' });
      prisma.hospitalUID.create.mockResolvedValue({ id: 'uid-1', uidCode: 'HSP00000001' });

      const result: any = await service.registerPatient({
        employeeId: 'EMP-1004',
        dob: '1992-05-15',
        gender: 'FEMALE',
        bloodGroup: 'B+',
      });

      expect(result.status).toBe('REGISTERED');
      expect(result.hospitalUid).toBeDefined();
      expect(result.qrDataUrl).toBe('data:image/png;base64,mockqr');
      expect(prisma.hospitalUID.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if Employee ID is already registered', async () => {
      prisma.employee.findUnique.mockResolvedValue(mockEmployee);

      await expect(service.registerPatient({ employeeId: 'EMP-1001' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('3. Patient Lookup by UID & Employee ID', () => {
    it('should find patient profile by Hospital UID', async () => {
      prisma.hospitalUID.findFirst.mockResolvedValue({
        id: 'uid-1',
        uidCode: 'HSP00000001',
        qrPayload: 'data:image/png;base64,mockqr',
        employee: mockEmployee,
      });

      const patient = await service.getPatientByUid('HSP00000001');

      expect(patient.hospitalUid).toBe('HSP00000001');
      expect(patient.name).toBe('Rajesh Kumar');
    });

    it('should throw NotFoundException when Hospital UID is missing', async () => {
      prisma.hospitalUID.findFirst.mockResolvedValue(null);

      await expect(service.getPatientByUid('INVALID_UID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('4. Visit Creation & Queue Token Generation', () => {
    it('should create OPD visit and issue OPD Queue Token', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.visit.findFirst.mockResolvedValue(null);
      prisma.visit.create.mockResolvedValue({
        id: 'visit-1',
        employeeId: mockEmployee.id,
        type: VisitType.OPD,
        status: VisitStatus.OPEN,
      });
      prisma.department.findFirst.mockResolvedValue({ id: 'dept-1', name: 'General Medicine' });
      prisma.oPDVisit.create.mockResolvedValue({
        id: 'opd-1',
        visitId: 'visit-1',
        tokenNumber: 'GENMED-001',
      });

      const result: any = await service.createVisit({
        employeeId: 'EMP-1001',
        type: VisitType.OPD,
      });

      expect(result.status).toBe('CREATED');
      expect(result.tokenNumber).toBe('GENMED-001');
    });

    it('should return OPEN_VISIT_WARNING if patient already has an active open visit', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.visit.findFirst.mockResolvedValue({
        id: 'visit-open-1',
        employeeId: mockEmployee.id,
        status: VisitStatus.OPEN,
      });

      const result = await service.createVisit({
        employeeId: 'EMP-1001',
        type: VisitType.OPD,
      });

      expect(result.status).toBe('OPEN_VISIT_WARNING');
    });
  });

  describe('5. Longitudinal Medical History', () => {
    it('should retrieve patient complete medical history timeline', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        visits: [
          {
            id: 'visit-1',
            type: VisitType.OPD,
            status: VisitStatus.CLOSED,
            createdAt: new Date(),
            opdVisit: { tokenNumber: 'GENMED-001', department: { name: 'General Medicine' } },
            diagnoses: [{ id: 'diag-1', diagnosisText: 'Viral Fever' }],
            prescriptions: [{ id: 'rx-1', status: 'SIGNED', items: [] }],
            labOrders: [],
            admissions: [],
          },
        ],
      });

      const history = await service.getPatientMedicalHistory('EMP-1001');

      expect(history.patient).toBeDefined();
      expect(history.timeline.length).toBe(1);
      expect(history.summary.totalVisits).toBe(1);
    });
  });
});
