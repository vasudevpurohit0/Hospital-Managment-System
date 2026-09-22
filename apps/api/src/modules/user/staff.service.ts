import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { getTenantContext } from '../../common/tenant/tenant-context';
import { generateSecurePassword } from '../../common/security/password.util';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../../common/email/email.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { STAFF_ROLE_NAMES, STAFF_ROLE_PREFIXES, StaffRoleName } from './dto/staff-role.const';
import { CreateDefaultRolesDto, DEFAULT_BULK_ROLES } from './dto/create-default-roles.dto';
import { AccountLifecycleService, Actor, AccountPasswordOpts, TEMP_PASSWORD_TTL_MS } from './account-lifecycle.service';
import { toAuditActorUserId } from '../../common/audit/audit-actor.util';
import { DoctorService } from './doctor.service';

export type { Actor };

/**
 * Bulk-provisioning ("Create Roles Automatically") identifier + display
 * helpers. Identifiers mirror the seed convention
 * (`{local}@{tenant-tag}.esic.gov.in`, tag derived from the tenant schema
 * name) so they are valid emails, unique platform-wide, and clearly
 * recognizable as system-generated login ids -- not real mailboxes.
 */
export function bulkTenantTag(schemaName: string): string {
  return schemaName.replace(/^hospital_/, '').replace(/_/g, '-');
}

export function bulkIdentifierForRole(role: string, schemaName: string): string {
  const local = role.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${local}@${bulkTenantTag(schemaName)}.esic.gov.in`;
}

const BULK_ROLE_DISPLAY_NAMES: Record<string, string> = {
  THERAPY_STAFF: 'Therapy Staff',
  OPDDisplayOperator: 'OPD Display Operator',
};

export function bulkDisplayNameForRole(role: string): string {
  const mapped = BULK_ROLE_DISPLAY_NAMES[role];
  if (mapped) return mapped;
  return role.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

type StaffUser = {
  id: string;
  identifier: string;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  role: { name: string };
  employee: {
    employeeId: string;
    name: string;
    department: string;
    designation: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  } | null;
  staffShifts: { dayOfWeek: string; startTime: string; endTime: string; active: boolean }[];
  departmentAssignments: {
    isPrimary: boolean;
    department: { id: string; name: string; code: string };
  }[];
};

export interface StaffDto {
  id: string;
  name: string;
  email: string;
  role: string;
  staffId: string | null;
  department: string;
  designation: string | null;
  contactPhone: string | null;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  dateJoined: Date;
  weeklySchedule: { day: string; startTime: string; endTime: string; available: boolean }[];
  departments: { id: string; name: string; code: string; isPrimary: boolean }[];
}

export interface StaffFilters {
  role?: string;
  department?: string;
  search?: string;
  /** 'active' | 'inactive' | 'locked' -- locked overrides active/inactive display, same priority DoctorSchedulePage uses. */
  status?: string;
  page?: number;
  limit?: number;
}

const DEFAULT_STAFF_PAGE_LIMIT = 25;
const MAX_STAFF_PAGE_LIMIT = 100;

@Injectable()
export class StaffService extends AccountLifecycleService<StaffDto> {
  constructor(
    prisma: PrismaService,
    loginDirectory: LoginDirectoryService,
    private readonly sequences: DocumentSequenceService,
    authService: AuthService,
    emailService: EmailService,
    private readonly doctorService: DoctorService,
  ) {
    super(prisma, loginDirectory, authService, emailService);
  }

  protected readonly accountKind = 'staff';
  protected roleNameFor(user: StaffUser): string {
    return user.role.name;
  }

  protected readonly listSelect = {
    id: true,
    identifier: true,
    active: true,
    mustChangePassword: true,
    passwordChangedAt: true,
    lastLoginAt: true,
    createdAt: true,
    role: { select: { name: true } },
    employee: {
      select: {
        employeeId: true,
        name: true,
        department: true,
        designation: true,
        contactPhone: true,
        contactEmail: true,
      },
    },
    staffShifts: { select: { dayOfWeek: true, startTime: true, endTime: true, active: true } },
    departmentAssignments: {
      select: { isPrimary: true, department: { select: { id: true, name: true, code: true } } },
    },
  } as const;

  protected toDto(u: StaffUser) {
    return {
      id: u.id,
      name: u.employee?.name ?? u.identifier,
      email: u.identifier,
      role: u.role.name,
      staffId: u.employee?.employeeId ?? null,
      department: u.employee?.department ?? 'General',
      designation: u.employee?.designation ?? null,
      contactPhone: u.employee?.contactPhone ?? null,
      active: u.active,
      mustChangePassword: u.mustChangePassword,
      passwordChangedAt: u.passwordChangedAt,
      lastLoginAt: u.lastLoginAt,
      dateJoined: u.createdAt,
      weeklySchedule: u.staffShifts.map((s) => ({
        day: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        available: s.active,
      })),
      departments: u.departmentAssignments.map((a) => ({
        ...a.department,
        isPrimary: a.isPrimary,
      })),
    };
  }

  async findAllForAdmin(filters: StaffFilters) {
    const roles = filters.role ? [filters.role] : STAFF_ROLE_NAMES;
    const users = await this.prisma.user.findMany({
      where: {
        role: { name: { in: roles } },
        ...(filters.department
          ? {
              OR: [
                { employee: { department: filters.department } },
                { departmentAssignments: { some: { departmentId: filters.department } } },
              ],
            }
          : {}),
        ...(filters.search
          ? {
              OR: [
                { identifier: { contains: filters.search, mode: 'insensitive' } },
                { employee: { name: { contains: filters.search, mode: 'insensitive' } } },
                { employee: { employeeId: { contains: filters.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: this.listSelect,
      orderBy: [{ role: { name: 'asc' } }, { employee: { name: 'asc' } }],
    });

    const identifiers = users.map((u) => u.identifier);
    const statuses = await this.loginDirectory.getStatuses(identifiers);

    const filtered = users
      .map((u) => {
        const status = statuses.get(u.identifier.trim().toLowerCase());
        const locked = !!(
          status?.manuallyLockedAt ||
          (status?.lockedUntil && status.lockedUntil > new Date())
        );
        return { ...this.toDto(u), locked, failedLoginAttempts: status?.failedAttempts ?? 0 };
      })
      .filter((s) => {
        if (!filters.status) return true;
        if (filters.status === 'locked') return s.locked;
        if (filters.status === 'active') return s.active && !s.locked;
        if (filters.status === 'inactive') return !s.active;
        return true;
      });

    // Filtering by status/search happens in-process on top of a DB-level
    // role/department/search prefilter, so pagination is applied last, on
    // the final filtered set -- correct for the staff-list scale this
    // screen deals with (dozens to low hundreds of accounts per hospital).
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(
      MAX_STAFF_PAGE_LIMIT,
      Math.max(1, filters.limit ?? DEFAULT_STAFF_PAGE_LIMIT),
    );
    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const user = await this.requireAccountUser(id);
    return this.toDto(
      await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: this.listSelect }),
    );
  }

  protected async requireAccountUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { employee: true, role: true },
    });
    if (!user || !STAFF_ROLE_NAMES.includes(user.role.name as StaffRoleName)) {
      throw new NotFoundException(`Staff member not found: ${id}`);
    }
    return user;
  }

  async createStaff(dto: CreateStaffDto, actor?: Actor, opts?: AccountPasswordOpts) {
    const email = dto.email.trim().toLowerCase();
    const { hospitalId } = getTenantContext();

    // Register in the global login directory first -- see doctor.service.ts
    // for why this can't share a transaction with the tenant-side write.
    await this.loginDirectory.register(email, hospitalId);

    let created: Awaited<ReturnType<typeof this.createStaffInTenant>>;
    try {
      created = await this.createStaffInTenant(dto, email, actor, opts);
    } catch (err) {
      await this.loginDirectory.remove(email).catch(() => undefined);
      throw err;
    }

    // Deliberately after the transaction commits, not inside it -- an email
    // failure must never roll back a successful account creation. Bulk
    // creation ("Create Roles Automatically") suppresses these: the
    // identifiers are placeholders without real mailboxes, and the shared
    // initial password is handed over in person by the creating admin.
    if (!opts?.suppressEmails) {
      await this.sendCredentialEmails({
        identifier: created.email,
        staffName: created.name,
        staffId: created.staffId,
        actorUserId: this.actorTenantUserId(actor) ?? undefined,
        temporaryPassword: created.temporaryPassword,
      });
    }

    return created;
  }

  private async createStaffInTenant(dto: CreateStaffDto, email: string, actor?: Actor, opts?: AccountPasswordOpts) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { name: dto.role } });
      if (!role) {
        throw new BadRequestException(`Role "${dto.role}" is not seeded for this hospital.`);
      }

      // Bulk creation supplies the admin-chosen initial password; single
      // creation mints a fresh random one. Either way only the bcrypt hash
      // is persisted, and `temporaryPassword` is returned once so the
      // creating admin can hand it over in person.
      const temporaryPassword = opts?.initialPassword ?? generateSecurePassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      const staffId = await this.sequences.nextStaffId(STAFF_ROLE_PREFIXES[dto.role], tx);

      const post =
        (await tx.post.findFirst({ where: { title: 'Senior Officer' } })) ||
        (await tx.post.findFirst());
      const grade =
        (await tx.grade.findFirst({ where: { payLevel: 'Pay Level 10' } })) ||
        (await tx.grade.findFirst());
      const empType =
        (await tx.employmentType.findFirst({ where: { code: 'PERMANENT' } })) ||
        (await tx.employmentType.findFirst());
      if (!post || !grade || !empType) {
        throw new Error('Master data for employee creation is missing (Post/Grade/EmpType)');
      }

      const employee = await tx.employee.create({
        data: {
          employeeId: staffId,
          name: dto.name,
          department: dto.department,
          designation: dto.designation,
          contactPhone: dto.contactPhone,
          contactEmail: email,
          postId: post.id,
          gradeId: grade.id,
          employmentTypeId: empType.id,
        },
      });

      const user = await tx.user.create({
        data: {
          identifier: email,
          passwordHash,
          roleId: role.id,
          employeeId: employee.id,
          active: true,
          mustChangePassword: opts?.requirePasswordChange ?? true,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
        },
      });

      if (dto.weeklySchedule?.length) {
        await tx.staffShift.createMany({
          data: dto.weeklySchedule.map((s) => ({
            userId: user.id,
            dayOfWeek: s.day,
            startTime: s.startTime,
            endTime: s.endTime,
            active: s.available,
          })),
        });
      }

      if (dto.departmentIds?.length) {
        await tx.staffDepartmentAssignment.createMany({
          data: dto.departmentIds.map((departmentId, idx) => ({
            userId: user.id,
            departmentId,
            isPrimary: idx === 0,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: this.actorTenantUserId(actor),
          actorRole: actor?.roleName ?? 'System',
          action: 'staff.created',
          entityType: 'User',
          entityId: user.id,
          afterSnapshot: { email, name: dto.name, role: dto.role, staffId },
        },
      });

      return {
        id: user.id,
        name: employee.name,
        role: dto.role,
        staffId,
        department: employee.department,
        designation: employee.designation,
        contactPhone: employee.contactPhone,
        email,
        temporaryPassword,
      };
    });
  }

  /**
   * "Create Roles Automatically" preview: every bulk-provisionable role with
   * the identifier it WOULD get and whether an account already exists for it.
   * Read-only -- creates nothing.
   */
  async getDefaultRolesStatus() {
    const { schemaName } = getTenantContext();
    const statuses: {
      role: string;
      displayName: string;
      identifier: string;
      exists: boolean;
      active: boolean | null;
    }[] = [];
    for (const role of DEFAULT_BULK_ROLES) {
      const identifier = bulkIdentifierForRole(role, schemaName);
      const existing = await this.prisma.user.findUnique({
        where: { identifier },
        select: { id: true, active: true },
      });
      statuses.push({
        role,
        displayName: bulkDisplayNameForRole(role),
        identifier,
        exists: !!existing,
        active: existing?.active ?? null,
      });
    }
    return statuses;
  }

  /**
   * "Create Roles Automatically": provisions one login-ready account per
   * requested default role, all sharing the admin-chosen initial password.
   *
   * Guarantees (per the acceptance criteria):
   * - No activation: accounts are active immediately (same direct-creation
   *   semantics as provisionAdministrator -- active row + bcrypt hash, login
   *   works at once, forced first-login change when requirePasswordChange).
   * - Idempotent: roles whose identifier already exists are SKIPPED, never
   *   touched (no password reset, no data/status/permission change).
   * - Hospital-scoped: the hospital comes from the caller's trusted tenant
   *   context; the DTO carries no hospitalId, so cross-hospital creation is
   *   structurally impossible.
   * - Secrets: the initial password is hashed independently per account
   *   (bcrypt salts differ), and is never returned, logged, snapshotted, or
   *   emailed by this operation.
   *
   * Not one atomic transaction by design: tenant rows (this database) and
   * login-directory rows (the platform database) cannot share a transaction,
   * so each account reuses the single-create flow with its built-in
   * directory compensation, and per-role results are reported. A failure
   * affects only that role -- previously created roles in the same run are
   * valid accounts and are reported as created, never rolled back.
   */
  async createDefaultRoleAccounts(dto: CreateDefaultRolesDto, actor?: Actor) {
    if (!dto.initialPassword.trim()) {
      throw new BadRequestException('Initial password must not be blank.');
    }
    if (dto.initialPassword !== dto.confirmPassword) {
      throw new BadRequestException('Initial password and confirmation do not match.');
    }
    const requested = dto.roles?.length ? dto.roles : [...DEFAULT_BULK_ROLES];
    const unknown = requested.filter((r) => !(DEFAULT_BULK_ROLES as readonly string[]).includes(r));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown roles: ${unknown.join(', ')}. Allowed: ${DEFAULT_BULK_ROLES.join(', ')}`,
      );
    }
    const requirePasswordChange = dto.requirePasswordChange ?? true;
    const { schemaName } = getTenantContext();

    const created: { role: string; identifier: string }[] = [];
    const skipped: { role: string; identifier: string; reason: string }[] = [];
    const failed: { role: string; identifier: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const role of requested) {
      const identifier = bulkIdentifierForRole(role, schemaName);
      if (seen.has(role)) {
        skipped.push({ role, identifier, reason: 'DUPLICATE_REQUEST' });
        continue;
      }
      seen.add(role);
      const existing = await this.prisma.user.findUnique({ where: { identifier }, select: { id: true } });
      if (existing) {
        skipped.push({ role, identifier, reason: 'EXISTS' });
        continue;
      }
      try {
        const opts = { initialPassword: dto.initialPassword, requirePasswordChange, suppressEmails: true };
        if (role === 'Doctor') {
          // Doctor accounts need a DoctorProfile row the generic staff path
          // never creates; department is assigned later from Doctor Schedule.
          await this.doctorService.createDoctor(
            {
              name: bulkDisplayNameForRole(role),
              specialty: 'General Physician',
              experience: 'N/A',
              email: identifier,
            },
            actor,
            opts,
          );
        } else {
          await this.createStaff(
            {
              name: bulkDisplayNameForRole(role),
              role: role as StaffRoleName,
              email: identifier,
              department: 'General',
            },
            actor,
            opts,
          );
        }
        created.push({ role, identifier });
      } catch (err) {
        failed.push({ role, identifier, reason: err instanceof Error ? err.message : 'Creation failed' });
      }
    }

    // Summary audit: roles and counts only -- never the password or its hash
    // (per-account staff.created/doctor.created audits are already written by
    // the single-create flows above, also password-free).
    await this.writeAuditLog(
      this.prisma,
      'staff.default_roles_created',
      actor,
      actor && actor.type !== 'platform' ? actor.id : 'default-roles',
      {
        // These aren't real AuditLog columns (there is no rolesCreated/rolesSkipped/
        // rolesFailed/requirePasswordChange field on the model) -- passing them as
        // top-level keys made Prisma's create() reject the whole call at runtime
        // with a misleading "Unknown argument actorUserId" error, since valid and
        // invalid keys were mixed in the same object. afterSnapshot is the real
        // JSON field this codebase already uses elsewhere in this file for exactly
        // this kind of free-form audit detail (see activated/deactivated above).
        afterSnapshot: {
          rolesCreated: created.map((c) => c.role),
          rolesSkipped: skipped.map((s) => `${s.role} (${s.reason})`),
          rolesFailed: failed.map((f) => `${f.role} (${f.reason})`),
          requirePasswordChange,
        },
      },
    );

    return {
      created,
      skipped,
      failed,
      createdCount: created.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      requirePasswordChange,
    };
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actor?: Actor) {
    const user = await this.requireAccountUser(id);

    await this.prisma.$transaction(async (tx) => {
      const employeeUpdates: Record<string, unknown> = {};
      if (dto.name !== undefined) employeeUpdates.name = dto.name;
      if (dto.department !== undefined) employeeUpdates.department = dto.department;
      if (dto.designation !== undefined) employeeUpdates.designation = dto.designation;
      if (dto.contactPhone !== undefined) employeeUpdates.contactPhone = dto.contactPhone;

      if (Object.keys(employeeUpdates).length > 0 && user.employeeId) {
        await tx.employee.update({ where: { id: user.employeeId }, data: employeeUpdates });
      }

      if (dto.email) {
        const newEmail = dto.email.trim().toLowerCase();
        const oldEmail = user.identifier;
        if (newEmail !== oldEmail) {
          await this.loginDirectory.rename(oldEmail, newEmail);
          await tx.user.update({ where: { id }, data: { identifier: newEmail } });
          if (user.employeeId) {
            await tx.employee.update({
              where: { id: user.employeeId },
              data: { contactEmail: newEmail },
            });
          }
          await tx.auditLog.create({
            data: {
              actorUserId: this.actorTenantUserId(actor),
              actorRole: actor?.roleName ?? 'System',
              action: 'staff.email_changed',
              entityType: 'User',
              entityId: id,
              beforeSnapshot: { email: oldEmail },
              afterSnapshot: { email: newEmail },
            },
          });
        }
      }

      if (dto.weeklySchedule) {
        await tx.staffShift.deleteMany({ where: { userId: id } });
        if (dto.weeklySchedule.length > 0) {
          await tx.staffShift.createMany({
            data: dto.weeklySchedule.map((s) => ({
              userId: id,
              dayOfWeek: s.day,
              startTime: s.startTime,
              endTime: s.endTime,
              active: s.available,
            })),
          });
        }
      }

      if (dto.departmentIds) {
        await tx.staffDepartmentAssignment.deleteMany({ where: { userId: id } });
        if (dto.departmentIds.length > 0) {
          await tx.staffDepartmentAssignment.createMany({
            data: dto.departmentIds.map((departmentId, idx) => ({
              userId: id,
              departmentId,
              isPrimary: idx === 0,
            })),
          });
        }
      }
    });

    return this.toDto(
      await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.listSelect }),
    );
  }
}
