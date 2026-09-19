import { Test, TestingModule } from '@nestjs/testing';
import { AdmissionService } from './admission.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacilityEligibilityService } from '../facility/facility.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { IpdFinanceService } from './ipd-finance.service';
import { AdmissionStatus, BedStatus } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('AdmissionService', () => {
  let service: AdmissionService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    admission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    bed: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    dischargeSummary: {
      upsert: jest.fn(),
    },
  };

  const mockIpdFinance = {
    postBedDayForAdmission: jest.fn().mockResolvedValue('posted'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdmissionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FacilityEligibilityService, useValue: { resolve: jest.fn() } },
        { provide: DocumentSequenceService, useValue: { next: jest.fn() } },
        { provide: IpdFinanceService, useValue: mockIpdFinance },
      ],
    }).compile();

    service = module.get<AdmissionService>(AdmissionService);
    jest.clearAllMocks();
    mockPrismaService.$transaction.mockImplementation((cb) => cb(mockPrismaService));
    mockIpdFinance.postBedDayForAdmission.mockResolvedValue('posted');
  });

  describe('discharge', () => {
    const baseAdmission = {
      id: 'adm-1',
      bedId: 'bed-1',
      status: AdmissionStatus.UNDER_TREATMENT,
      visit: { employee: {} },
    };

    it('rejects a second discharge call on an already-DISCHARGED admission (regression: duplicate discharge could steal another patient\'s bed)', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue({
        ...baseAdmission,
        status: AdmissionStatus.DISCHARGED,
      });

      await expect(
        service.discharge('adm-1', { summaryText: 'ok' }, 'user-1', 'Doctor'),
      ).rejects.toThrow(ConflictException);

      // Must fail before ever touching the bed or writing the discharge summary.
      expect(mockPrismaService.bed.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.dischargeSummary.upsert).not.toHaveBeenCalled();
    });

    it('only frees the bed if it still belongs to this admission (conditional updateMany, not an unconditional update)', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue(baseAdmission);
      mockPrismaService.bed.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.admission.update.mockResolvedValue({ id: 'adm-1', status: AdmissionStatus.DISCHARGED });

      await service.discharge('adm-1', { summaryText: 'ok' }, 'user-1', 'Doctor');

      expect(mockPrismaService.bed.updateMany).toHaveBeenCalledWith({
        where: { id: 'bed-1', currentAdmissionId: 'adm-1' },
        data: { status: BedStatus.AVAILABLE, currentAdmissionId: null },
      });
      // The unconditional single-row `update` must never be used for this --
      // that was the exact bug that let a stale discharge steal another
      // patient's bed.
      expect(mockPrismaService.bed.update).not.toHaveBeenCalled();
    });

    it('does not throw when the bed no longer belongs to this admission (already reassigned) -- discharge still completes', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue(baseAdmission);
      mockPrismaService.bed.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaService.admission.update.mockResolvedValue({ id: 'adm-1', status: AdmissionStatus.DISCHARGED });

      const result = await service.discharge('adm-1', { summaryText: 'ok' }, 'user-1', 'Doctor');

      expect(result.status).toBe(AdmissionStatus.DISCHARGED);
    });

    it('bills the discharge-day bed charge before marking the admission discharged (idempotent safety net)', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue(baseAdmission);
      mockPrismaService.bed.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.admission.update.mockResolvedValue({ id: 'adm-1', status: AdmissionStatus.DISCHARGED });

      await service.discharge('adm-1', { summaryText: 'ok' }, 'user-1', 'Doctor');

      expect(mockIpdFinance.postBedDayForAdmission).toHaveBeenCalledWith(
        'adm-1',
        expect.any(Date),
        mockPrismaService,
      );
    });

    it('rejects a role other than Doctor/Administrator/SuperAdmin', async () => {
      await expect(
        service.discharge('adm-1', { summaryText: 'ok' }, 'user-1', 'Reception'),
      ).rejects.toThrow();
      expect(mockPrismaService.admission.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('allocateBed', () => {
    it('refuses to allocate a bed to an already-DISCHARGED admission (regression: prevents "un-discharging")', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
        visit: { employee: {} },
      });

      await expect(
        service.allocateBed('adm-1', { bedId: 'bed-2' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.bed.findUnique).not.toHaveBeenCalled();
    });

    it('allows allocation for a non-discharged admission', async () => {
      mockPrismaService.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.ELIGIBILITY_CHECKED,
        visit: { employee: {} },
      });
      mockPrismaService.bed.findUnique.mockResolvedValue({
        id: 'bed-2',
        bedNumber: 'B-2',
        status: BedStatus.AVAILABLE,
        currentAdmissionId: null,
        room: { id: 'room-1', wardId: 'ward-1' },
      });
      mockPrismaService.bed.updateMany
        .mockResolvedValueOnce({ count: 0 }) // step 1a: release any previous bed -- none held
        .mockResolvedValueOnce({ count: 1 }); // step 2: claim the target bed
      mockPrismaService.admission.update.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.UNDER_TREATMENT,
        bedId: 'bed-2',
      });

      const result = await service.allocateBed('adm-1', { bedId: 'bed-2' }, 'user-1');

      expect(result.status).toBe(AdmissionStatus.UNDER_TREATMENT);
      expect(mockIpdFinance.postBedDayForAdmission).toHaveBeenCalled();
    });
  });
});
