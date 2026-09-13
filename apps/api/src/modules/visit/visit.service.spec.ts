import { Test, TestingModule } from '@nestjs/testing';
import { VisitService } from './visit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { VisitType, VisitStatus } from '@prisma/client';

describe('VisitService', () => {
  let service: VisitService;

  const mockPrismaService = {
    employee: {
      findFirst: jest.fn(),
    },
    visit: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    admission: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'adm-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DocumentSequenceService, useValue: { next: jest.fn().mockResolvedValue('IPD/2026/000001') } },
      ],
    }).compile();

    service = module.get<VisitService>(VisitService);
    jest.clearAllMocks();
  });

  it('should return OPEN_VISIT_WARNING if an open visit already exists for the employee', async () => {
    mockPrismaService.employee.findFirst.mockResolvedValue({ id: 'emp-1001-id' });
    mockPrismaService.visit.findFirst.mockResolvedValue({
      id: 'open-v-1',
      employeeId: 'emp-1001-id',
      type: 'OPD',
      status: VisitStatus.OPEN,
    });

    const result = await service.createVisit({
      employeeId: 'emp-1001-id',
      type: VisitType.OPD,
    });

    expect(result.status).toBe('OPEN_VISIT_WARNING');
    expect(result.openVisit).toBeDefined();
  });

  it('should create visit when ignoreOpenVisitWarning is true', async () => {
    mockPrismaService.employee.findFirst.mockResolvedValue({ id: 'emp-1001-id' });
    mockPrismaService.visit.findFirst.mockResolvedValue({
      id: 'open-v-1',
      employeeId: 'emp-1001-id',
      type: 'OPD',
      status: VisitStatus.OPEN,
    });
    mockPrismaService.visit.create.mockResolvedValue({
      id: 'new-v-2',
      employeeId: 'emp-1001-id',
      type: VisitType.IPD,
      status: VisitStatus.OPEN,
    });

    const result = await service.createVisit({
      employeeId: 'emp-1001-id',
      type: VisitType.IPD,
      ignoreOpenVisitWarning: true,
    });

    expect(result.status).toBe('CREATED');
    expect(result.visit?.id).toBe('new-v-2');
  });
});
