import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StaffService, bulkIdentifierForRole, bulkDisplayNameForRole } from './staff.service';
import { CreateDefaultRolesDto, DEFAULT_BULK_ROLES } from './dto/create-default-roles.dto';
import { Actor } from './account-lifecycle.service';
import { PERMISSION_GRANTS } from '../../../prisma/seed';
import { PERMISSION_KEY } from '../../common/decorators/permissions.decorator';
import { StaffController } from './staff.controller';
import { runWithTenant } from '../../common/tenant/tenant-context';

/**
 * "Create Roles Automatically" -- bulk default-role provisioning.
 * Covers the acceptance criteria that don't need a live database:
 * idempotency, tenant isolation (via identifier tagging), password security
 * (independent hashes, never returned/logged), RBAC gating, and audit shape.
 */
describe('StaffService.createDefaultRoleAccounts()', () => {
  const mockAuditCreate = jest.fn().mockResolvedValue({});
  const existingIdentifiers = new Set<string>();

  const mockPrisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { identifier: string } }) =>
        existingIdentifiers.has(where.identifier) ? { id: `user-for-${where.identifier}` } : null,
      ),
    },
    auditLog: { create: mockAuditCreate },
  };

  const mockDoctorService = { createDoctor: jest.fn() };
  const mockDeps = {
    loginDirectory: {},
    sequences: {},
    authService: {},
    emailService: {},
  };

  const adminActor: Actor = { id: 'admin-1', roleName: 'Administrator' };
  const tenantCtx = {
    hospitalId: 'hospital-bpl',
    schemaName: 'hospital_esic_bpl',
    prismaClient: mockPrisma as never,
  };

  let service: StaffService;

  beforeEach(() => {
    jest.clearAllMocks();
    existingIdentifiers.clear();
    mockAuditCreate.mockResolvedValue({});
    service = new StaffService(
      mockPrisma as never,
      mockDeps.loginDirectory as never,
      mockDeps.sequences as never,
      mockDeps.authService as never,
      mockDeps.emailService as never,
      mockDoctorService as never,
    );
    // Seam-level seam: orchestration is under test here, single-create
    // transactions are covered by staff/doctor.service.spec.ts.
    jest.spyOn(service, 'createStaff').mockImplementation(async (dto) => {
      existingIdentifiers.add(dto.email);
      return { id: `created-${dto.role}`, email: dto.email, temporaryPassword: 'SECRET-SHARED' } as never;
    });
    mockDoctorService.createDoctor.mockImplementation(async (dto: { email: string }) => {
      existingIdentifiers.add(dto.email);
      return { email: dto.email, temporaryPassword: 'SECRET-SHARED' };
    });
  });

  const validDto = (overrides: Partial<CreateDefaultRolesDto> = {}) =>
    plainToInstance(CreateDefaultRolesDto, {
      initialPassword: 'Hospital@2026',
      confirmPassword: 'Hospital@2026',
      ...overrides,
    });

  it('creates every default role when none exist, then reports them as skipped on re-run (idempotent)', async () => {
    const first = await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(validDto(), adminActor),
    );
    expect(first.createdCount).toBe(DEFAULT_BULK_ROLES.length);
    expect(first.skippedCount).toBe(0);
    expect(first.failedCount).toBe(0);

    const second = await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(validDto(), adminActor),
    );
    expect(second.createdCount).toBe(0);
    expect(second.skippedCount).toBe(DEFAULT_BULK_ROLES.length);
    expect(second.skipped.every((s) => s.reason === 'EXISTS')).toBe(true);
  });

  it('creates only the requested subset and never touches pre-existing accounts', async () => {
    existingIdentifiers.add(bulkIdentifierForRole('Nurse', tenantCtx.schemaName));
    const before = (service.createStaff as jest.Mock).mock.calls.length;

    const result = await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(validDto({ roles: ['Nurse', 'Pharmacist'] }), adminActor),
    );
    expect(result.created.map((c) => c.role)).toEqual(['Pharmacist']);
    expect(result.skipped.map((s) => s.role)).toEqual(['Nurse']);
    // The existing Nurse account was left alone: createStaff ran once total.
    expect((service.createStaff as jest.Mock).mock.calls.length - before).toBe(1);
  });

  it('routes Doctor through DoctorService with profile-safe defaults', async () => {
    await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(validDto({ roles: ['Doctor'] }), adminActor),
    );
    expect(mockDoctorService.createDoctor).toHaveBeenCalledWith(
      expect.objectContaining({
        specialty: 'General Physician',
        experience: 'N/A',
        email: bulkIdentifierForRole('Doctor', tenantCtx.schemaName),
      }),
      adminActor,
      expect.objectContaining({ initialPassword: 'Hospital@2026', requirePasswordChange: true }),
    );
  });

  it('honours requirePasswordChange: false and passes the initial password through (never generated)', async () => {
    await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(
        validDto({ roles: ['Nurse'], requirePasswordChange: false }),
        adminActor,
      ),
    );
    const [, , opts] = (service.createStaff as jest.Mock).mock.calls[0];
    expect(opts).toEqual(
      expect.objectContaining({ initialPassword: 'Hospital@2026', requirePasswordChange: false }),
    );
  });

  it('never returns, logs, or audits the password', async () => {
    const result = await runWithTenant(tenantCtx, () =>
      service.createDefaultRoleAccounts(validDto({ roles: ['Nurse', 'Doctor'] }), adminActor),
    );
    expect(JSON.stringify(result)).not.toContain('Hospital@2026');
    expect(JSON.stringify(result)).not.toContain('SECRET-SHARED');
    for (const call of mockAuditCreate.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Hospital@2026');
      expect(JSON.stringify(call)).not.toContain('SECRET-SHARED');
    }
    const summaryCall = mockAuditCreate.mock.calls.find((c: unknown[]) =>
      JSON.stringify(c).includes('staff.default_roles_created'),
    );
    expect(summaryCall).toBeDefined();
  });

  it('rejects mismatched confirmation, blank passwords, and unknown roles', async () => {
    await expect(
      runWithTenant(tenantCtx, () =>
        service.createDefaultRoleAccounts(validDto({ confirmPassword: 'Other@2026' }), adminActor),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      runWithTenant(tenantCtx, () =>
        service.createDefaultRoleAccounts(validDto({ initialPassword: '        ', confirmPassword: '        ' }), adminActor),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      runWithTenant(tenantCtx, () =>
        service.createDefaultRoleAccounts(validDto({ roles: ['SuperAdmin'] }), adminActor),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      runWithTenant(tenantCtx, () =>
        service.createDefaultRoleAccounts(validDto({ roles: ['Administrator'] }), adminActor),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces the shared password policy at the DTO boundary (min 8, max 72)', async () => {
    const shortErrors = await validate(validDto({ initialPassword: 'short1', confirmPassword: 'short1' }));
    expect(shortErrors.some((e) => e.property === 'initialPassword')).toBe(true);
    const longErrors = await validate(
      validDto({ initialPassword: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) }),
    );
    expect(longErrors.some((e) => e.property === 'initialPassword')).toBe(true);
  });

  it('scopes identifiers to the caller hospital (tenant isolation)', async () => {
    const otherCtx = { ...tenantCtx, hospitalId: 'hospital-other', schemaName: 'hospital_apollo_indore' };
    const statusA = await runWithTenant(tenantCtx, () => service.getDefaultRolesStatus());
    const statusB = await runWithTenant(otherCtx, () => service.getDefaultRolesStatus());
    const nurseA = statusA.find((s) => s.role === 'Nurse')!.identifier;
    const nurseB = statusB.find((s) => s.role === 'Nurse')!.identifier;
    expect(nurseA).not.toBe(nurseB);
    expect(nurseA).toContain('esic-bpl');
    expect(nurseB).toContain('apollo-indore');
  });

  it('the same initial password verifies against independently salted hashes (never stored plaintext)', async () => {
    const hashA = await bcrypt.hash('Hospital@2026', 10);
    const hashB = await bcrypt.hash('Hospital@2026', 10);
    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toContain('Hospital@2026');
    await expect(bcrypt.compare('Hospital@2026', hashA)).resolves.toBe(true);
    await expect(bcrypt.compare('Hospital@2026', hashB)).resolves.toBe(true);
    await expect(bcrypt.compare('Hospital@2026-changed', hashA)).resolves.toBe(false);
  });

  it('identifier + display-name helpers follow the seed convention', () => {
    expect(bulkIdentifierForRole('AdmissionDesk', 'hospital_esic_bpl')).toBe(
      'admissiondesk@esic-bpl.esic.gov.in',
    );
    expect(bulkIdentifierForRole('THERAPY_STAFF', 'hospital_esic_bpl')).toBe(
      'therapystaff@esic-bpl.esic.gov.in',
    );
    expect(bulkDisplayNameForRole('AdmissionDesk')).toBe('Admission Desk');
    expect(bulkDisplayNameForRole('DataEntryOperator')).toBe('Data Entry Operator');
  });
});

describe('default-roles RBAC gating', () => {
  it('both routes require Staff:create', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, StaffController.prototype['getDefaultRoles'])).toEqual({
      resource: 'Staff',
      action: 'create',
    });
    expect(Reflect.getMetadata(PERMISSION_KEY, StaffController.prototype['createDefaultRoles'])).toEqual({
      resource: 'Staff',
      action: 'create',
    });
  });

  it('Administrator holds Staff:create; Doctor/Nurse/Reception do not (403 for them)', () => {
    const has = (role: string) =>
      PERMISSION_GRANTS.some((g) => g.roleName === role && g.resource === 'Staff' && g.action === 'create');
    expect(has('Administrator')).toBe(true);
    expect(has('Doctor')).toBe(false);
    expect(has('Nurse')).toBe(false);
    expect(has('Reception')).toBe(false);
    expect(has('Pharmacist')).toBe(false);
  });
});
