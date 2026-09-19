import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const mockPrisma = {
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService(mockPrisma as never);
  });

  describe('findAll()', () => {
    it('filters by actorUserId, action (case-insensitive contains), entityType, and date range together', async () => {
      await service.findAll({
        actorUserId: 'user-1',
        action: 'password',
        entityType: 'User',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg).toEqual({
        actorUserId: 'user-1',
        action: { contains: 'password', mode: 'insensitive' },
        entityType: 'User',
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
      });
    });

    it('defaults to page 1 / limit 50, and caps limit at 200', async () => {
      await service.findAll({});
      expect(mockPrisma.auditLog.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      await service.findAll({ limit: 10000 });
      expect(mockPrisma.auditLog.findMany.mock.calls[1][0]).toEqual(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('paginates correctly for page 3', async () => {
      await service.findAll({ page: 3, limit: 20 });
      expect(mockPrisma.auditLog.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it('returns total/page/limit/totalPages in meta', async () => {
      mockPrisma.auditLog.count.mockResolvedValueOnce(101);
      const result = await service.findAll({ page: 1, limit: 50 });
      expect(result.meta).toEqual({ total: 101, page: 1, limit: 50, totalPages: 3 });
    });

    it('filters by status and severity', async () => {
      await service.findAll({ status: 'FAILURE', severity: 'CRITICAL' });
      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg).toEqual({ status: 'FAILURE', severity: 'CRITICAL' });
    });

    it('builds an OR search across actor, module, description, and IP for the free-text query', async () => {
      await service.findAll({ q: '49.43.6.216' });
      const whereArg = mockPrisma.auditLog.findMany.mock.calls[0][0].where;
      expect(whereArg.OR).toEqual(
        expect.arrayContaining([
          { ipAddress: { contains: '49.43.6.216', mode: 'insensitive' } },
          { actorUser: { identifier: { contains: '49.43.6.216', mode: 'insensitive' } } },
        ]),
      );
    });
  });

  describe('getStats()', () => {
    it('returns total, last-24h, critical, and failed-login counts from four independent queries', async () => {
      mockPrisma.auditLog.count
        .mockResolvedValueOnce(4881) // total
        .mockResolvedValueOnce(1) // last24h
        .mockResolvedValueOnce(1472) // critical
        .mockResolvedValueOnce(189); // failedLogins

      const stats = await service.getStats();

      expect(stats).toEqual({ total: 4881, last24h: 1, critical: 1472, failedLogins: 189 });
      expect(mockPrisma.auditLog.count).toHaveBeenNthCalledWith(3, { where: { severity: 'CRITICAL' } });
      expect(mockPrisma.auditLog.count).toHaveBeenNthCalledWith(4, { where: { action: 'auth.login_failed' } });
    });
  });

  describe('exportCsv()', () => {
    it('renders a CSV with a header row and one row per audit entry, never truncating the reason field', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValueOnce([
        {
          createdAt: new Date('2026-01-15T10:00:00Z'),
          actorUser: { identifier: 'admin@esic.gov.in', employee: { name: 'Admin User', employeeId: 'ADX-0001' } },
          actorRole: 'Administrator',
          action: 'staff.locked',
          entityType: 'User',
          entityId: 'user-1',
          reason: 'Suspicious, multiple failed logins',
        },
      ]);

      const csv = await service.exportCsv({});
      expect(csv).toContain('Timestamp,Actor,Staff ID,Role,Action,Module,Record ID,Status,Severity,IP Address,Browser,OS,Description,Reason');
      expect(csv).toContain('admin@esic.gov.in');
      expect(csv).toContain('ADX-0001');
      expect(csv).toContain('staff.locked');
      expect(csv).toContain('Suspicious, multiple failed logins');
    });

    it('falls back to "System" for a system-actioned entry with no actorUser', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValueOnce([
        {
          createdAt: new Date('2026-01-15T10:00:00Z'),
          actorUser: null,
          actorRole: 'System',
          action: 'procurement.auto_requisition',
          entityType: 'PurchaseRequisition',
          entityId: 'req-1',
          reason: null,
        },
      ]);

      const csv = await service.exportCsv({});
      expect(csv).toContain('System');
    });
  });
});
