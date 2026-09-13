import { Test, TestingModule } from '@nestjs/testing';
import { PatientLookupService } from './patient-lookup.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('PatientLookupService', () => {
  let service: PatientLookupService;

  const mockPrismaService = {
    employee: {
      findFirst: jest.fn(),
    },
    hospitalUID: {
      create: jest.fn(),
    },
    patientProfile: {
      create: jest.fn(),
    },
    admission: {
      findFirst: jest.fn(),
    },
    prescription: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PatientLookupService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<PatientLookupService>(PatientLookupService);
    jest.clearAllMocks();
  });

  it('should return composite patient lookup result in a single query', async () => {
    mockPrismaService.employee.findFirst.mockResolvedValue({
      id: 'emp-1001-id',
      employeeId: 'EMP-1001',
      name: 'Rajesh Kumar',
      department: 'Public Works',
      post: { title: 'Clerk' },
      grade: { payLevel: 'Pay Level 4' },
      employmentType: { name: 'Permanent' },
      patientProfile: { eligibilityCategory: 'C' },
      hospitalUid: { uidCode: 'ESIC-2026-000001' },
      visits: [{ id: 'v1', type: 'OPD', status: 'CLOSED', createdAt: new Date('2026-07-20') }],
    });
    mockPrismaService.admission.findFirst.mockResolvedValue(null);
    mockPrismaService.prescription.findMany.mockResolvedValue([]);

    const result = await service.lookupByUid('ESIC-2026-000001');

    expect(result).toBeDefined();
    expect(result.employee.uid).toBe('ESIC-2026-000001');
    expect(result.employee.name).toBe('Rajesh Kumar');
    expect(result.historySummary.length).toBe(1);
    expect(result.historySummary[0].type).toBe('OPD');
  });

  it('should not create missing UID/profile records during lookup', async () => {
    mockPrismaService.employee.findFirst.mockResolvedValue({
      id: 'emp-1001-id',
      employeeId: 'EMP-1001',
      name: 'Rajesh Kumar',
      department: 'Public Works',
      post: null,
      grade: null,
      employmentType: null,
      patientProfile: null,
      hospitalUid: null,
      visits: [],
    });
    mockPrismaService.admission.findFirst.mockResolvedValue(null);
    mockPrismaService.prescription.findMany.mockResolvedValue([]);

    const result = await service.lookupByUid('EMP-1001');

    expect(result.employee.uid).toBe('EMP-1001');
    expect(result.employee.post).toBe('Unknown');
    expect(result.employee.grade).toBe('Unknown');
    expect(result.employee.employmentType).toBe('Unknown');
    expect(mockPrismaService.hospitalUID.create).not.toHaveBeenCalled();
    expect(mockPrismaService.patientProfile.create).not.toHaveBeenCalled();
  });

  it('should propagate a real error instead of masking a database failure', async () => {
    mockPrismaService.employee.findFirst.mockRejectedValue(new Error('DB offline'));

    await expect(service.lookupByUid('ESIC-2026-000001')).rejects.toThrow('DB offline');
  });

  it('should throw NotFoundException when no employee matches the UID', async () => {
    mockPrismaService.employee.findFirst.mockResolvedValue(null);

    await expect(service.lookupByUid('UNKNOWN-UID')).rejects.toThrow(
      'No patient profile found for UID / Employee ID: UNKNOWN-UID',
    );
  });
});
