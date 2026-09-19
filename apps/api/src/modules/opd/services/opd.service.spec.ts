import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OpdService, QueueActor } from './opd.service';

describe('OpdService', () => {
  let service: OpdService;

  const mockPrisma = {
    oPDVisit: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    doctorProfile: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };

  const mockTokenGenerator = { generateDailyToken: jest.fn() };
  const mockDepartmentService = { findById: jest.fn() };
  const mockChargeService = { postServiceChargeIfPriced: jest.fn() };
  const mockBenefitRuleService = { evaluate: jest.fn() };
  const mockSequences = { next: jest.fn() };

  const doctorActor: QueueActor = { id: 'doctor-1', roleName: 'Doctor' };
  const otherDoctorActor: QueueActor = { id: 'doctor-2', roleName: 'Doctor' };
  const adminActor: QueueActor = { id: 'admin-1', roleName: 'Administrator' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
    // Checked in and not on a break, by default -- the AVAILABLE state every
    // pre-existing callNext test implicitly assumed before duty status
    // existed. Tests that care about OFF_DUTY/ON_BREAK override this.
    mockPrisma.doctorProfile.findUnique.mockResolvedValue({ dutyStatus: 'AVAILABLE' });
    service = new OpdService(
      mockPrisma as never,
      mockTokenGenerator as never,
      mockDepartmentService as never,
      mockChargeService as never,
      mockBenefitRuleService as never,
      mockSequences as never,
    );
  });

  describe('doctor-specific queue isolation (ownership checks)', () => {
    const visit = { id: 'visit-1', doctorId: 'doctor-1', departmentId: 'dept-1', status: 'WAITING' };

    it('callToken: 404s a Doctor caller acting on another doctor\'s visit -- never confirms it exists', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(visit);
      await expect(service.callToken('visit-1', otherDoctorActor)).rejects.toThrow(NotFoundException);
    });

    it('callToken: allows the owning doctor to call their own waiting visit', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(visit);
      mockPrisma.oPDVisit.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.oPDVisit.update.mockResolvedValue({ ...visit, status: 'CALLED' });

      const result = await service.callToken('visit-1', doctorActor);
      expect(result.status).toBe('CALLED');
    });

    it('callToken: an unrestricted role (Administrator) may act on any doctor\'s visit', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(visit);
      mockPrisma.oPDVisit.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.oPDVisit.update.mockResolvedValue({ ...visit, status: 'CALLED' });

      await expect(service.callToken('visit-1', adminActor)).resolves.toBeDefined();
    });

    it('startConsultation: 404s a Doctor caller for another doctor\'s visit', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ ...visit, status: 'CALLED' });
      await expect(service.startConsultation('visit-1', otherDoctorActor)).rejects.toThrow(NotFoundException);
    });

    it('markNoShow/skip/cancel: 404s a Doctor caller for another doctor\'s visit', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(visit);
      await expect(service.markNoShow('visit-1', otherDoctorActor)).rejects.toThrow(NotFoundException);
      await expect(service.skip('visit-1', otherDoctorActor)).rejects.toThrow(NotFoundException);
      await expect(service.cancel('visit-1', otherDoctorActor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('status transition guards', () => {
    it('startConsultation: rejects a visit that is not CALLED', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ id: 'v1', doctorId: 'doctor-1', status: 'WAITING' });
      await expect(service.startConsultation('v1', doctorActor)).rejects.toThrow(BadRequestException);
    });

    it('completeConsultation: accepts CALLED or IN_CONSULTATION, rejects others', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ id: 'v1', doctorId: 'doctor-1', status: 'WAITING' });
      await expect(service.completeConsultation('v1', doctorActor)).rejects.toThrow(BadRequestException);

      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ id: 'v1', doctorId: 'doctor-1', status: 'IN_CONSULTATION' });
      mockPrisma.oPDVisit.update.mockResolvedValue({ id: 'v1', status: 'COMPLETED', closedAt: new Date() });
      await expect(service.completeConsultation('v1', doctorActor)).resolves.toBeDefined();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'opdvisit.completed' }) }),
      );
    });

    it('terminalTransition (no-show/skip/cancel): rejects a visit already in a terminal state', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ id: 'v1', doctorId: 'doctor-1', status: 'COMPLETED' });
      await expect(service.markNoShow('v1', doctorActor)).rejects.toThrow(BadRequestException);
    });

    it('markNoShow: records the reason and the correct audit action', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ id: 'v1', doctorId: 'doctor-1', status: 'WAITING' });
      mockPrisma.oPDVisit.update.mockResolvedValue({ id: 'v1', status: 'NO_SHOW' });

      await service.markNoShow('v1', doctorActor, 'Patient did not arrive');

      expect(mockPrisma.oPDVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'NO_SHOW', skipReason: 'Patient did not arrive' }) }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'opdvisit.no_show', reason: 'Patient did not arrive' }) }),
      );
    });
  });

  describe('callNext() -- atomic claim', () => {
    it('refuses to call next while the doctor is on a break', async () => {
      mockPrisma.doctorProfile.findUnique.mockResolvedValue({ dutyStatus: 'ON_BREAK' });
      await expect(service.callNext('doctor-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.oPDVisit.findFirst).not.toHaveBeenCalled();
    });

    it('refuses to call next while the doctor is checked out', async () => {
      mockPrisma.doctorProfile.findUnique.mockResolvedValue({ dutyStatus: 'OFF_DUTY' });
      await expect(service.callNext('doctor-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.oPDVisit.findFirst).not.toHaveBeenCalled();
    });

    it('refuses to call next while the doctor already has a CALLED/IN_CONSULTATION visit', async () => {
      mockPrisma.oPDVisit.findFirst.mockResolvedValueOnce({ id: 'in-progress' });
      await expect(service.callNext('doctor-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when there is no waiting candidate', async () => {
      mockPrisma.oPDVisit.findFirst
        .mockResolvedValueOnce(null) // no in-progress visit
        .mockResolvedValueOnce(null); // no waiting candidate
      await expect(service.callNext('doctor-1')).rejects.toThrow(NotFoundException);
    });

    it('claims the first eligible waiting visit and marks it CALLED', async () => {
      mockPrisma.oPDVisit.findFirst
        .mockResolvedValueOnce(null) // no in-progress visit
        .mockResolvedValueOnce({ id: 'v1' }); // candidate
      mockPrisma.oPDVisit.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.oPDVisit.findUniqueOrThrow.mockResolvedValue({ id: 'v1', status: 'CALLED' });

      const result = await service.callNext('doctor-1');
      expect(result.status).toBe('CALLED');
      expect(mockPrisma.oPDVisit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1', status: 'WAITING' } }),
      );
    });

    it('throws ConflictException when a concurrent call already claimed the same candidate (updateMany matches zero rows)', async () => {
      mockPrisma.oPDVisit.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'v1' });
      mockPrisma.oPDVisit.updateMany.mockResolvedValue({ count: 0 }); // lost the race

      await expect(service.callNext('doctor-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('transfer() -- reassignment', () => {
    const activeVisit = { id: 'v1', doctorId: 'doctor-1', departmentId: 'dept-1', status: 'WAITING' };

    it('requires a non-blank reason before anything else is checked', async () => {
      await expect(service.transfer('v1', 'doctor-2', adminActor)).rejects.toThrow(
        'A reason is required to reassign a patient.',
      );
      await expect(service.transfer('v1', 'doctor-2', adminActor, '   ')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.oPDVisit.findUnique).not.toHaveBeenCalled();
    });

    it('validates the new doctor is eligible for the visit\'s department before reassigning', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(activeVisit);
      mockPrisma.user.findUnique.mockResolvedValue({
        active: true,
        role: { name: 'Doctor' },
        doctorProfile: { departmentId: 'dept-2', departments: [] }, // wrong department
      });

      await expect(service.transfer('v1', 'doctor-2', adminActor, 'Doctor on leave')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reassigns doctorId, resets to WAITING, and audit-logs opdvisit.transferred', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue(activeVisit);
      mockPrisma.user.findUnique.mockResolvedValue({
        active: true,
        role: { name: 'Doctor' },
        doctorProfile: { departmentId: 'dept-1', departments: [] },
      });
      mockPrisma.oPDVisit.count.mockResolvedValue(0);
      mockPrisma.oPDVisit.update.mockResolvedValue({ id: 'v1', doctorId: 'doctor-2', status: 'WAITING' });

      const result = await service.transfer('v1', 'doctor-2', adminActor, 'Doctor on leave');

      expect(result.doctorId).toBe('doctor-2');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'opdvisit.transferred', reason: 'Doctor on leave' }) }),
      );
    });

    it('rejects transferring a visit already in a terminal state', async () => {
      mockPrisma.oPDVisit.findUnique.mockResolvedValue({ ...activeVisit, status: 'COMPLETED' });
      await expect(service.transfer('v1', 'doctor-2', adminActor, 'Doctor on leave')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
