import { DoctorService, Actor } from './doctor.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

const DEFAULT_DOCTOR_LIST_SELECT_RESULT = {
  id: 'doctor-user-1',
  identifier: 'a.new.doctor@esic.gov.in',
  active: true,
  mustChangePassword: true,
  passwordChangedAt: null,
  lastLoginAt: null,
  createdAt: new Date(),
  doctorProfile: {
    id: 'profile-1',
    specialty: 'Cardiologist',
    experience: '5 Years',
    available: true,
    verified: false,
    departmentId: 'dept-1',
    consultationFee: 0,
    weeklySchedule: null,
    department: { id: 'dept-1', name: 'Cardiology', code: 'CARDIO' },
  },
  employee: { name: 'Dr. New Doctor', department: 'Cardiology', consultationRoom: null, contactPhone: null },
};

describe('DoctorService', () => {
  let service: DoctorService;

  const mockTx = {
    role: { findUnique: jest.fn(), create: jest.fn() },
    user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    post: { findFirst: jest.fn() },
    grade: { findFirst: jest.fn() },
    employmentType: { findFirst: jest.fn() },
    employee: { create: jest.fn(), update: jest.fn() },
    doctorProfile: { create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    oPDVisit: { groupBy: jest.fn() },
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

  const mockSequences = {
    nextStaffId: jest.fn().mockResolvedValue('DOC-0001'),
  };

  const adminActor: Actor = { id: 'admin-1', roleName: 'Administrator' };
  const tenantCtx = { hospitalId: 'hospital-1', schemaName: 'hospital_esic_model', prismaClient: mockPrisma as never };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockTx));
    mockLoginDirectory.register.mockResolvedValue(undefined);
    mockLoginDirectory.remove.mockResolvedValue(undefined);
    mockSequences.nextStaffId.mockResolvedValue('DOC-0001');
    mockPrisma.hospitalSettings.findUnique.mockResolvedValue({ sendTemporaryPasswordByEmail: false });
    service = new DoctorService(
      mockPrisma as never,
      mockLoginDirectory as never,
      mockSequences as never,
      mockAuthService as never,
      mockEmailService as never,
    );
  });

  describe('createDoctor()', () => {
    const createDto = {
      name: 'Dr. New Doctor',
      specialty: 'Cardiologist',
      experience: '5 Years',
      email: 'A.New.Doctor@ESIC.gov.in',
      departmentId: 'dept-1',
    };

    beforeEach(() => {
      mockTx.role.findUnique.mockResolvedValue({ id: 'role-doctor', name: 'Doctor' });
      mockTx.post.findFirst.mockResolvedValue({ id: 'post-1' });
      mockTx.grade.findFirst.mockResolvedValue({ id: 'grade-1' });
      mockTx.employmentType.findFirst.mockResolvedValue({ id: 'empType-1' });
      mockTx.user.create.mockResolvedValue({ id: 'doctor-user-1' });
      mockTx.employee.create.mockResolvedValue({ id: 'employee-1', name: createDto.name });
      mockTx.doctorProfile.create.mockResolvedValue({
        specialty: createDto.specialty,
        experience: createDto.experience,
        available: true,
        departmentId: createDto.departmentId,
        consultationFee: 0,
        weeklySchedule: null,
      });
    });

    it('normalizes the email before registering it in the login directory', async () => {
      await runWithTenant(tenantCtx, () => service.createDoctor(createDto, adminActor));
      expect(mockLoginDirectory.register).toHaveBeenCalledWith('a.new.doctor@esic.gov.in', 'hospital-1');
    });

    it('generates a random, non-predictable temporary password and never stores it in plaintext', async () => {
      const result = await runWithTenant(tenantCtx, () => service.createDoctor(createDto, adminActor));

      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).not.toBe('DoctorPass123!');
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      // Two calls must never produce the same password.
      const second = await runWithTenant(tenantCtx, () => service.createDoctor(createDto, adminActor));
      expect(second.temporaryPassword).not.toBe(result.temporaryPassword);

      const createCallData = mockTx.user.create.mock.calls[0][0].data;
      expect(createCallData.passwordHash).not.toBe(result.temporaryPassword);
      expect(createCallData.mustChangePassword).toBe(true);
    });

    it('writes a doctor.created audit log entry', async () => {
      await runWithTenant(tenantCtx, () => service.createDoctor(createDto, adminActor));
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.created', actorUserId: 'admin-1' }) }),
      );
    });

    it('rolls back the login-directory registration if the tenant transaction fails', async () => {
      mockTx.doctorProfile.create.mockRejectedValueOnce(new Error('db write failed'));

      await expect(runWithTenant(tenantCtx, () => service.createDoctor(createDto, adminActor))).rejects.toThrow(
        'db write failed',
      );
      expect(mockLoginDirectory.remove).toHaveBeenCalledWith('a.new.doctor@esic.gov.in');
    });
  });

  describe('resetPassword()', () => {
    it('generates a fresh one-time password, forces a password change, and never reveals the old password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'doctor-user-1',
        identifier: 'doctor@esic.gov.in',
        doctorProfile: { id: 'profile-1' },
        employee: null,
      });

      const result = await runWithTenant(tenantCtx, () =>
        service.resetPassword('doctor-user-1', adminActor, 'Forgot password'),
      );

      expect(result.temporaryPassword).toBeDefined();
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doctor-user-1' },
          data: expect.objectContaining({ mustChangePassword: true, passwordChangedAt: null }),
        }),
      );
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'doctor.password_reset', reason: 'Forgot password' }),
        }),
      );
    });

    it('throws NotFoundException for a user with no doctor profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'x', doctorProfile: null });
      await expect(service.resetPassword('x', adminActor)).rejects.toThrow('Doctor not found');
    });
  });

  describe('setLocked()', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'doctor-user-1',
        identifier: 'doctor@esic.gov.in',
        doctorProfile: { id: 'profile-1' },
        employee: null,
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_DOCTOR_LIST_SELECT_RESULT);
    });

    it('locking delegates to loginDirectory.lockManually and audit-logs doctor.locked', async () => {
      await service.setLocked('doctor-user-1', true, adminActor, 'Suspicious activity');
      expect(mockLoginDirectory.lockManually).toHaveBeenCalledWith('doctor@esic.gov.in');
      expect(mockLoginDirectory.unlock).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.locked', reason: 'Suspicious activity' }) }),
      );
    });

    it('unlocking delegates to loginDirectory.unlock and audit-logs doctor.unlocked', async () => {
      await service.setLocked('doctor-user-1', false, adminActor);
      expect(mockLoginDirectory.unlock).toHaveBeenCalledWith('doctor@esic.gov.in');
      expect(mockLoginDirectory.lockManually).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.unlocked' }) }),
      );
    });
  });

  describe('updateDoctor()', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'doctor-user-1',
        identifier: 'old.email@esic.gov.in',
        employeeId: 'employee-1',
        doctorProfile: { id: 'profile-1', departmentId: 'dept-1' },
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_DOCTOR_LIST_SELECT_RESULT);
    });

    it('renames the login-directory identifier before updating the tenant User row on an email change', async () => {
      await service.updateDoctor('doctor-user-1', { email: 'New.Email@ESIC.gov.in' }, adminActor);

      expect(mockLoginDirectory.rename).toHaveBeenCalledWith('old.email@esic.gov.in', 'new.email@esic.gov.in');
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'doctor-user-1' }, data: { identifier: 'new.email@esic.gov.in' } }),
      );
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.email_changed' }) }),
      );
    });

    it('does not touch the identifier or write an audit entry when the email is unchanged', async () => {
      await service.updateDoctor('doctor-user-1', { email: 'old.email@esic.gov.in' }, adminActor);
      expect(mockLoginDirectory.rename).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.email_changed' }) }),
      );
    });

    it('audit-logs doctor.department_changed when the department actually changes', async () => {
      await service.updateDoctor('doctor-user-1', { departmentId: 'dept-2' }, adminActor);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'doctor.department_changed',
            beforeSnapshot: { departmentId: 'dept-1' },
            afterSnapshot: { departmentId: 'dept-2' },
          }),
        }),
      );
    });
  });

  describe('session invalidation & credential emails', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'doctor-user-1',
        identifier: 'doctor@esic.gov.in',
        doctorProfile: { id: 'profile-1' },
        employee: { name: 'Dr. New Doctor', employeeId: 'DOC-0001' },
      });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue(DEFAULT_DOCTOR_LIST_SELECT_RESULT);
    });

    it('resetPassword bumps tokenVersion and sends no activation email', async () => {
      await runWithTenant(tenantCtx, () => service.resetPassword('doctor-user-1', adminActor));
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) }),
      );
      expect(mockAuthService.sendActivationEmail).not.toHaveBeenCalled();
    });

    it('setLocked(true) bumps tokenVersion; setLocked(false) does not', async () => {
      await service.setLocked('doctor-user-1', true, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'doctor-user-1' },
        data: { tokenVersion: { increment: 1 } },
      });

      mockPrisma.user.update.mockClear();
      await service.setLocked('doctor-user-1', false, adminActor);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('setActive(false) bumps tokenVersion; setActive(true) does not', async () => {
      mockTx.user.update.mockResolvedValue(DEFAULT_DOCTOR_LIST_SELECT_RESULT);
      await service.setActive('doctor-user-1', false, adminActor);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false, tokenVersion: { increment: 1 } } }),
      );

      mockTx.user.update.mockClear();
      await service.setActive('doctor-user-1', true, adminActor);
      expect(mockTx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { active: true } }));
    });

    it('resendActivation sends a fresh activation email and audit-logs doctor.activation_resent', async () => {
      await runWithTenant(tenantCtx, () => service.resendActivation('doctor-user-1', adminActor));
      expect(mockAuthService.sendActivationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'doctor@esic.gov.in', role: 'Doctor' }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'doctor.activation_resent' }) }),
      );
    });
  });

  describe('findLeastBusyEligibleDoctor()', () => {
    const doctorRow = (id: string) => ({ ...DEFAULT_DOCTOR_LIST_SELECT_RESULT, id, identifier: `${id}@esic.gov.in` });

    it('returns null when no doctor is eligible for the department', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await service.findLeastBusyEligibleDoctor('dept-1');
      expect(result).toBeNull();
    });

    it('picks the eligible doctor with the fewest active queue entries', async () => {
      mockPrisma.user.findMany.mockResolvedValue([doctorRow('doc-a'), doctorRow('doc-b'), doctorRow('doc-c')]);
      mockPrisma.oPDVisit.groupBy.mockResolvedValue([
        { doctorId: 'doc-a', _count: { _all: 5 } },
        { doctorId: 'doc-b', _count: { _all: 1 } },
        // doc-c has no active visits at all -- absent from groupBy results entirely
      ]);

      const result = await service.findLeastBusyEligibleDoctor('dept-1');
      expect(result?.id).toBe('doc-c');
    });

    it('only counts active statuses (WAITING/CALLED/IN_CONSULTATION)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([doctorRow('doc-a')]);
      mockPrisma.oPDVisit.groupBy.mockResolvedValue([]);

      await service.findLeastBusyEligibleDoctor('dept-1');

      expect(mockPrisma.oPDVisit.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } }),
        }),
      );
    });
  });
});
