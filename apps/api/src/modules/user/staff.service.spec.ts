import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotFoundException } from '@nestjs/common';
import { StaffService, Actor } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { runWithTenant } from '../../common/tenant/tenant-context';

const DEFAULT_STAFF_LIST_SELECT_RESULT = {
  id: 'staff-user-1',
  identifier: 'new.nurse@esic.gov.in',
  active: true,
  mustChangePassword: true,
  passwordChangedAt: null,
  lastLoginAt: null,
  createdAt: new Date(),
  role: { name: 'Nurse' },
  employee: {
    employeeId: 'NUR-0001',
    name: 'New Nurse',
    department: 'General Ward',
    designation: 'Staff Nurse',
    contactPhone: null,
    contactEmail: 'new.nurse@esic.gov.in',
  },
  staffShifts: [],
  departmentAssignments: [],
};

describe('StaffService', () => {
  let service: StaffService;

  const mockTx = {
    role: { findUnique: jest.fn() },
    user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    post: { findFirst: jest.fn() },
    grade: { findFirst: jest.fn() },
    employmentType: { findFirst: jest.fn() },
    employee: { create: jest.fn(), update: jest.fn() },
    staffShift: { createMany: jest.fn(), deleteMany: jest.fn() },
    staffDepartmentAssignment: { createMany: jest.fn(), deleteMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const mockPrisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    hospitalSettings: { findUnique: jest.fn().mockResolvedValue({ sendTemporaryPasswordByEmail: false }) },
    $transaction: jest.fn(),
  };

  const mockAuthService = {
    sendActivationEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
  };

  const mockLoginDirectory = {
    register: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    lockManually: jest.fn().mockResolvedValue(undefined),
    unlock: jest.fn().mockResolvedValue(undefined),
    getStatuses: jest.fn().mockResolvedValue(new Map()),
  };

  const mockSequences = { nextStaffId: jest.fn() };

  const adminActor: Actor = { id: 'admin-1', roleName: 'Administrator' };
  const tenantCtx = { hospitalId: 'hospital-1', schemaName: 'hospital_esic_model', prismaClient: mockPrisma as never };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockTx));
    mockLoginDirectory.register.mockResolvedValue(undefined);
    mockLoginDirectory.remove.mockResolvedValue(undefined);
    mockPrisma.hospitalSettings.findUnique.mockResolvedValue({ sendTemporaryPasswordByEmail: false });
    service = new StaffService(
      mockPrisma as never,
      mockLoginDirectory as never,
      mockSequences as never,
      mockAuthService as never,
      mockEmailService as never,
    );
  });

  describe('CreateStaffDto validation', () => {
    it('rejects role: "Doctor" -- Doctor accounts are managed from the Doctor Schedule screen, not this generic module', async () => {
      const dto = plainToInstance(CreateStaffDto, {
        name: 'Someone',
        role: 'Doctor',
        email: 'someone@esic.gov.in',
        department: 'Cardiology',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'role')).toBe(true);
    });

    it('accepts every non-Doctor seeded role', async () => {
      const roles = ['Nurse', 'Reception', 'Pharmacist', 'LabTechnician', 'Pathologist', 'AdmissionDesk', 'QueueManager', 'StoreManager', 'ProcurementOfficer', 'DataEntryOperator', 'Administrator', 'Accountant'];
      for (const role of roles) {
        const dto = plainToInstance(CreateStaffDto, {
          name: 'Someone',
          role,
          email: 'someone@esic.gov.in',
          department: 'General',
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'role')).toBe(false);
      }
    });
  });

  describe('createStaff()', () => {
    const createDto = {
      name: 'New Nurse',
      role: 'Nurse' as const,
      email: 'New.Nurse@ESIC.gov.in',
      department: 'General Ward',
      designation: 'Staff Nurse',
    };

    beforeEach(() => {
      mockTx.role.findUnique.mockResolvedValue({ id: 'role-nurse', name: 'Nurse' });
      mockTx.post.findFirst.mockResolvedValue({ id: 'post-1' });
      mockTx.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockTx.employmentType.findFirst.mockResolvedValue({ id: 'empType-1' });
      mockTx.user.create.mockResolvedValue({ id: 'staff-user-1' });
      mockTx.employee.create.mockResolvedValue({
        id: 'employee-1',
        name: createDto.name,
        department: createDto.department,
        designation: createDto.designation,
        contactPhone: null,
      });
      mockSequences.nextStaffId.mockResolvedValue('NUR-0001');
    });

    it('normalizes the email and registers it in the login directory', async () => {
      await runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor));
      expect(mockLoginDirectory.register).toHaveBeenCalledWith('new.nurse@esic.gov.in', 'hospital-1');
    });

    it('allocates the staff ID via the role-prefixed sequence, not a hand-built string', async () => {
      const result = await runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor));
      expect(mockSequences.nextStaffId).toHaveBeenCalledWith('NUR', mockTx);
      expect(result.staffId).toBe('NUR-0001');
    });

    it('uses a different prefix per role', async () => {
      mockTx.role.findUnique.mockResolvedValue({ id: 'role-rec', name: 'Reception' });
      mockSequences.nextStaffId.mockResolvedValue('REC-0001');
      await runWithTenant(tenantCtx, () =>
        service.createStaff({ ...createDto, role: 'Reception' as never }, adminActor),
      );
      expect(mockSequences.nextStaffId).toHaveBeenCalledWith('REC', mockTx);
    });

    it('generates a random, non-predictable temporary password, never stored in plaintext, and forces a password change', async () => {
      const result = await runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor));
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);

      const second = await runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor));
      expect(second.temporaryPassword).not.toBe(result.temporaryPassword);

      const createCallData = mockTx.user.create.mock.calls[0][0].data;
      expect(createCallData.passwordHash).not.toBe(result.temporaryPassword);
      expect(createCallData.mustChangePassword).toBe(true);
    });

    it('writes a staff.created audit log entry', async () => {
      await runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor));
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.created', actorUserId: 'admin-1' }) }),
      );
    });

    it('rolls back the login-directory registration if the tenant transaction fails', async () => {
      mockTx.employee.create.mockRejectedValueOnce(new Error('db write failed'));
      await expect(runWithTenant(tenantCtx, () => service.createStaff(createDto, adminActor))).rejects.toThrow(
        'db write failed',
      );
      expect(mockLoginDirectory.remove).toHaveBeenCalledWith('new.nurse@esic.gov.in');
    });

    it('persists weeklySchedule rows as StaffShift, mapping available -> active', async () => {
      await runWithTenant(tenantCtx, () =>
        service.createStaff(
          { ...createDto, weeklySchedule: [{ day: 'MON', startTime: '09:00', endTime: '17:00', available: true }] },
          adminActor,
        ),
      );
      expect(mockTx.staffShift.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'staff-user-1', dayOfWeek: 'MON', startTime: '09:00', endTime: '17:00', active: true }],
      });
    });
  });

  describe('resetPassword()', () => {
    it('generates a fresh one-time password and forces a password change', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'staff-user-1',
        identifier: 'nurse@esic.gov.in',
        role: { name: 'Nurse' },
        employee: null,
      });

      const result = await runWithTenant(tenantCtx, () =>
        service.resetPassword('staff-user-1', adminActor, 'Forgot password'),
      );

      expect(result.temporaryPassword).toBeDefined();
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'staff-user-1' },
          data: expect.objectContaining({ mustChangePassword: true, passwordChangedAt: null }),
        }),
      );
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.password_reset' }) }),
      );
    });

    it('throws NotFoundException for a non-staff user (e.g. a Doctor id, which this module never manages)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'x', role: { name: 'Doctor' } });
      await expect(service.resetPassword('x', adminActor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('setLocked()', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'staff-user-1',
        identifier: 'nurse@esic.gov.in',
        role: { name: 'Nurse' },
        employee: null,
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
    });

    it('locking delegates to loginDirectory.lockManually and audit-logs staff.locked', async () => {
      await service.setLocked('staff-user-1', true, adminActor, 'Suspicious activity');
      expect(mockLoginDirectory.lockManually).toHaveBeenCalledWith('nurse@esic.gov.in');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.locked', reason: 'Suspicious activity' }) }),
      );
    });

    it('unlocking delegates to loginDirectory.unlock and audit-logs staff.unlocked', async () => {
      await service.setLocked('staff-user-1', false, adminActor);
      expect(mockLoginDirectory.unlock).toHaveBeenCalledWith('nurse@esic.gov.in');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.unlocked' }) }),
      );
    });
  });

  describe('updateStaff()', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'staff-user-1',
        identifier: 'old.email@esic.gov.in',
        employeeId: 'employee-1',
        role: { name: 'Nurse' },
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
    });

    it('renames the login-directory identifier before updating the tenant User row on an email change', async () => {
      await service.updateStaff('staff-user-1', { email: 'New.Email@ESIC.gov.in' }, adminActor);
      expect(mockLoginDirectory.rename).toHaveBeenCalledWith('old.email@esic.gov.in', 'new.email@esic.gov.in');
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'staff-user-1' }, data: { identifier: 'new.email@esic.gov.in' } }),
      );
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.email_changed' }) }),
      );
    });

    it('does not touch the identifier when the email is unchanged', async () => {
      await service.updateStaff('staff-user-1', { email: 'old.email@esic.gov.in' }, adminActor);
      expect(mockLoginDirectory.rename).not.toHaveBeenCalled();
    });
  });

  describe('findAllForAdmin() -- tenant scoping is structural, not a service-level filter', () => {
    it('excludes Doctor from the role set when no role filter is given', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.findAllForAdmin({});
      const whereArg = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(whereArg.role.name.in).not.toContain('Doctor');
    });

    it('returns a paginated {items, meta} shape, defaulting to page 1 / limit 25', async () => {
      mockPrisma.user.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ ...DEFAULT_STAFF_LIST_SELECT_RESULT, id: `staff-${i}`, identifier: `staff${i}@esic.gov.in` })),
      );
      const result = await service.findAllForAdmin({});
      expect(result.items).toHaveLength(25);
      expect(result.meta).toEqual({ total: 30, page: 1, limit: 25, totalPages: 2 });
    });

    it('returns page 2 correctly', async () => {
      mockPrisma.user.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ ...DEFAULT_STAFF_LIST_SELECT_RESULT, id: `staff-${i}`, identifier: `staff${i}@esic.gov.in` })),
      );
      const result = await service.findAllForAdmin({ page: 2 });
      expect(result.items).toHaveLength(5);
      expect(result.meta.page).toBe(2);
    });
  });

  describe('resetPassword() -- session invalidation and credential email', () => {
    it('bumps tokenVersion and sets a 24h temp-password expiry', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
      await runWithTenant(tenantCtx, () => service.resetPassword('staff-user-1', adminActor));
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tokenVersion: { increment: 1 }, tempPasswordExpiresAt: expect.any(Date) }),
        }),
      );
    });

    it('always sends the activation email, and only sends the temp-password email when the hospital setting is enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
      mockPrisma.hospitalSettings.findUnique.mockResolvedValue({ sendTemporaryPasswordByEmail: false });

      await runWithTenant(tenantCtx, () => service.resetPassword('staff-user-1', adminActor));
      expect(mockAuthService.sendActivationEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendMail).not.toHaveBeenCalled();

      mockPrisma.hospitalSettings.findUnique.mockResolvedValue({ sendTemporaryPasswordByEmail: true });
      await runWithTenant(tenantCtx, () => service.resetPassword('staff-user-1', adminActor));
      expect(mockEmailService.sendMail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendMail.mock.calls[0][0].kind).toBe('TEMP_PASSWORD');
    });
  });

  describe('setLocked() -- session invalidation', () => {
    it('bumps tokenVersion when locking, not when unlocking', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);

      await service.setLocked('staff-user-1', true, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'staff-user-1' },
        data: { tokenVersion: { increment: 1 } },
      });

      mockPrisma.user.update.mockClear();
      await service.setLocked('staff-user-1', false, adminActor);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendActivation()', () => {
    it('sends a fresh activation email and audit-logs staff.activation_resent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(DEFAULT_STAFF_LIST_SELECT_RESULT);
      await runWithTenant(tenantCtx, () => service.resendActivation('staff-user-1', adminActor));

      expect(mockAuthService.sendActivationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'new.nurse@esic.gov.in' }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'staff.activation_resent' }) }),
      );
    });
  });
});
