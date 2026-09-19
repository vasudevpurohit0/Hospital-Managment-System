import { DashboardService } from './dashboard.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

function user(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'user-1',
    identifier: 'someone@esic.gov.in',
    roleId: 'role-1',
    roleName: 'Doctor',
    permissions: [],
    type: 'hospital',
    ...overrides,
  };
}

describe('DashboardService.getMySummary()', () => {
  let service: DashboardService;

  const mockPrisma = {
    prescription: { count: jest.fn() },
    admission: { count: jest.fn() },
    admissionNote: { count: jest.fn() },
    visit: { count: jest.fn() },
    medicineBatch: { findMany: jest.fn() },
    labOrder: { count: jest.fn(), groupBy: jest.fn() },
    labResult: { count: jest.fn() },
    bed: { count: jest.fn() },
    oPDVisit: { count: jest.fn() },
    purchaseRequisition: { count: jest.fn() },
    purchaseOrder: { count: jest.fn() },
    employee: { count: jest.fn() },
    user: { groupBy: jest.fn(), count: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  };

  const mockOpdService = {
    getMyQueue: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(mockPrisma as never, mockOpdService as never);
  });

  it('Doctor: breaks its own queue into waiting/called counts and counts its own draft prescriptions', async () => {
    mockOpdService.getMyQueue.mockResolvedValue([
      { status: 'WAITING' },
      { status: 'WAITING' },
      { status: 'CALLED' },
    ]);
    mockPrisma.prescription.count.mockResolvedValue(2);

    const result = await service.getMySummary(user({ roleName: 'Doctor' }));

    expect(mockOpdService.getMyQueue).toHaveBeenCalledWith('user-1');
    expect(mockPrisma.prescription.count).toHaveBeenCalledWith({ where: { doctorId: 'user-1', status: 'DRAFT' } });
    expect(result).toEqual({ role: 'Doctor', waitingCount: 2, calledCount: 1, pendingPrescriptionDrafts: 2 });
  });

  it("Nurse: scopes admissions and notes to the caller's own assignedNurseId, never another nurse's", async () => {
    mockPrisma.admission.count.mockResolvedValue(3);
    mockPrisma.admissionNote.count.mockResolvedValue(1);

    await service.getMySummary(user({ id: 'nurse-1', roleName: 'Nurse' }));

    expect(mockPrisma.admission.count).toHaveBeenCalledWith({
      where: { assignedNurseId: 'nurse-1', status: 'UNDER_TREATMENT' },
    });
    expect(mockPrisma.admissionNote.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ admission: { assignedNurseId: 'nurse-1' } }) }),
    );
  });

  it('Pharmacist: counts the real SIGNED/PARTIALLY_DISPENSED queue and low-stock batches via the reorderLevel comparison', async () => {
    mockPrisma.prescription.count.mockResolvedValue(4);
    mockPrisma.medicineBatch.findMany.mockResolvedValue([
      { currentStock: 5, reorderLevel: 100 },
      { currentStock: 500, reorderLevel: 100 },
    ]);

    const result = await service.getMySummary(user({ roleName: 'Pharmacist' }));

    expect(result).toEqual({ role: 'Pharmacist', pendingQueue: 4, lowStock: 1 });
  });

  it('Pathologist: awaiting-verification and critical-unverified counts are two distinct, correctly-scoped queries', async () => {
    mockPrisma.labOrder.count.mockResolvedValue(7);
    mockPrisma.labResult.count.mockResolvedValue(2);

    const result = await service.getMySummary(user({ roleName: 'Pathologist' }));

    expect(mockPrisma.labOrder.count).toHaveBeenCalledWith({ where: { status: 'RESULT_ENTERED' } });
    expect(mockPrisma.labResult.count).toHaveBeenCalledWith({
      where: {
        flag: 'CRITICAL',
        labOrderItem: { labOrder: { status: { notIn: ['VERIFIED', 'REPORTED', 'CANCELLED'] } } },
      },
    });
    expect(result).toEqual({ role: 'Pathologist', awaitingVerification: 7, criticalUnverified: 2 });
  });

  it('QueueManager: one aggregate WAITING count across all departments', async () => {
    mockPrisma.oPDVisit.count.mockResolvedValue(12);
    const result = await service.getMySummary(user({ roleName: 'QueueManager' }));
    expect(mockPrisma.oPDVisit.count).toHaveBeenCalledWith({ where: { status: 'WAITING' } });
    expect(result).toEqual({ role: 'QueueManager', waitingAcrossDepartments: 12 });
  });

  it('Administrator: aggregates staff totals and recent security events', async () => {
    mockPrisma.user.groupBy.mockResolvedValue([{ roleId: 'r1', _count: { _all: 5 } }]);
    mockPrisma.user.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const result = await service.getMySummary(user({ roleName: 'Administrator' }));

    expect(result).toEqual(
      expect.objectContaining({ role: 'Administrator', totalStaff: 12, activeStaff: 10, inactiveStaff: 2, securityEventsToday: 2 }),
    );
  });

  it('falls back to a bare role tag for a role with no dashboard tile defined', async () => {
    const result = await service.getMySummary(user({ roleName: 'SomeUnhandledRole' }));
    expect(result).toEqual({ role: 'SomeUnhandledRole' });
  });
});
