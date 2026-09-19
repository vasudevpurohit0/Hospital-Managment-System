import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { getTenantContext } from '../../common/tenant/tenant-context';
import { generateSecurePassword } from '../../common/security/password.util';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../../common/email/email.service';
import { tempPasswordEmailBody, TEMP_PASSWORD_EMAIL_SUBJECT } from '../../common/email/templates';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { STAFF_ROLE_NAMES, STAFF_ROLE_PREFIXES, StaffRoleName } from './dto/staff-role.const';

const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60_000;

export interface Actor {
  id: string;
  roleName: string;
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
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginDirectory: LoginDirectoryService,
    private readonly sequences: DocumentSequenceService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Always sends the activation link (the account-created spec's default,
   * always-on path). If the hospital has opted into
   * `sendTemporaryPasswordByEmail`, also emails the temp password directly,
   * separately. Called after the triggering transaction has already
   * committed -- an email failure must never roll back or fail the staff
   * action that triggered it (AuthService/EmailService already swallow
   * their own errors; this stays fire-and-forget on top of that).
   */
  private async sendCredentialEmails(params: {
    identifier: string;
    staffName: string;
    staffId: string | null;
    role: string;
    hospitalId: string;
    actorUserId?: string;
    temporaryPassword?: string;
  }): Promise<void> {
    await this.authService
      .sendActivationEmail({
        identifier: params.identifier,
        staffName: params.staffName,
        staffId: params.staffId,
        role: params.role,
        hospitalId: params.hospitalId,
        actorUserId: params.actorUserId,
      })
      .catch(() => undefined);

    if (!params.temporaryPassword) return;

    const settings = await this.prisma.hospitalSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    if (!settings?.sendTemporaryPasswordByEmail) return;

    const { html, text } = tempPasswordEmailBody({
      staffName: params.staffName,
      loginEmail: params.identifier,
      temporaryPassword: params.temporaryPassword,
    });
    await this.emailService
      .sendMail({
        to: params.identifier,
        subject: TEMP_PASSWORD_EMAIL_SUBJECT,
        html,
        text,
        kind: 'TEMP_PASSWORD',
        sentByUserId: params.actorUserId,
      })
      .catch(() => undefined);
  }

  private readonly staffListSelect = {
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

  private toDto(u: {
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
    departmentAssignments: { isPrimary: boolean; department: { id: string; name: string; code: string } }[];
  }) {
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
      departments: u.departmentAssignments.map((a) => ({ ...a.department, isPrimary: a.isPrimary })),
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
      select: this.staffListSelect,
      orderBy: [{ role: { name: 'asc' } }, { employee: { name: 'asc' } }],
    });

    const identifiers = users.map((u) => u.identifier);
    const statuses = await this.loginDirectory.getStatuses(identifiers);

    const filtered = users
      .map((u) => {
        const status = statuses.get(u.identifier.trim().toLowerCase());
        const locked = !!(status?.manuallyLockedAt || (status?.lockedUntil && status.lockedUntil > new Date()));
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
    const limit = Math.min(MAX_STAFF_PAGE_LIMIT, Math.max(1, filters.limit ?? DEFAULT_STAFF_PAGE_LIMIT));
    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const user = await this.requireStaffUser(id);
    return this.toDto(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: this.staffListSelect }));
  }

  private async requireStaffUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { employee: true, role: true },
    });
    if (!user || !STAFF_ROLE_NAMES.includes(user.role.name as StaffRoleName)) {
      throw new NotFoundException(`Staff member not found: ${id}`);
    }
    return user;
  }

  async createStaff(dto: CreateStaffDto, actor?: Actor) {
    const email = dto.email.trim().toLowerCase();
    const { hospitalId } = getTenantContext();

    // Register in the global login directory first -- see doctor.service.ts
    // for why this can't share a transaction with the tenant-side write.
    await this.loginDirectory.register(email, hospitalId);

    let created: Awaited<ReturnType<typeof this.createStaffInTenant>>;
    try {
      created = await this.createStaffInTenant(dto, email, actor);
    } catch (err) {
      await this.loginDirectory.remove(email).catch(() => undefined);
      throw err;
    }

    // Deliberately after the transaction commits, not inside it -- an email
    // failure must never roll back a successful account creation.
    await this.sendCredentialEmails({
      identifier: created.email,
      staffName: created.name,
      staffId: created.staffId,
      role: created.role,
      hospitalId,
      actorUserId: actor?.id,
      temporaryPassword: created.temporaryPassword,
    });

    return created;
  }

  private async createStaffInTenant(dto: CreateStaffDto, email: string, actor?: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { name: dto.role } });
      if (!role) {
        throw new BadRequestException(`Role "${dto.role}" is not seeded for this hospital.`);
      }

      const temporaryPassword = generateSecurePassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      const staffId = await this.sequences.nextStaffId(STAFF_ROLE_PREFIXES[dto.role], tx);

      const post = (await tx.post.findFirst({ where: { title: 'Senior Officer' } })) || (await tx.post.findFirst());
      const grade = (await tx.grade.findFirst({ where: { payLevel: 'Pay Level 10' } })) || (await tx.grade.findFirst());
      const empType =
        (await tx.employmentType.findFirst({ where: { code: 'PERMANENT' } })) || (await tx.employmentType.findFirst());
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
          mustChangePassword: true,
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
          actorUserId: actor?.id ?? null,
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

  async updateStaff(id: string, dto: UpdateStaffDto, actor?: Actor) {
    const user = await this.requireStaffUser(id);

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
            await tx.employee.update({ where: { id: user.employeeId }, data: { contactEmail: newEmail } });
          }
          await tx.auditLog.create({
            data: {
              actorUserId: actor?.id ?? null,
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
            data: dto.departmentIds.map((departmentId, idx) => ({ userId: id, departmentId, isPrimary: idx === 0 })),
          });
        }
      }
    });

    return this.toDto(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.staffListSelect }));
  }

  /** Deactivates (never hard-deletes -- historical records reference this user). */
  async setActive(id: string, active: boolean, actor?: Actor) {
    const user = await this.requireStaffUser(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        // Deactivating also kills any already-issued session immediately,
        // not just future logins.
        data: active ? { active } : { active, tokenVersion: { increment: 1 } },
        select: this.staffListSelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor?.id ?? null,
          actorRole: actor?.roleName ?? 'System',
          action: active ? 'staff.activated' : 'staff.deactivated',
          entityType: 'User',
          entityId: id,
          beforeSnapshot: { active: user.active },
          afterSnapshot: { active },
        },
      });
      return u;
    });
    return this.toDto(updated);
  }

  async resetPassword(id: string, actor?: Actor, reason?: string) {
    const user = await this.requireStaffUser(id);
    const temporaryPassword = generateSecurePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
          tokenVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor?.id ?? null,
          actorRole: actor?.roleName ?? 'System',
          action: 'staff.password_reset',
          entityType: 'User',
          entityId: id,
          reason: reason ?? null,
        },
      });
    });

    const { hospitalId } = getTenantContext();
    await this.sendCredentialEmails({
      identifier: user.identifier,
      staffName: user.employee?.name ?? user.identifier,
      staffId: user.employee?.employeeId ?? null,
      role: user.role.name,
      hospitalId,
      actorUserId: actor?.id,
      temporaryPassword,
    });

    return { id, email: user.identifier, temporaryPassword };
  }

  async setLocked(id: string, locked: boolean, actor?: Actor, reason?: string) {
    const user = await this.requireStaffUser(id);
    if (locked) {
      await this.loginDirectory.lockManually(user.identifier);
      // Locking also kills any already-issued session immediately.
      await this.prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    } else {
      await this.loginDirectory.unlock(user.identifier);
    }
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor?.id ?? null,
        actorRole: actor?.roleName ?? 'System',
        action: locked ? 'staff.locked' : 'staff.unlocked',
        entityType: 'User',
        entityId: id,
        reason: reason ?? null,
      },
    });
    return this.toDto(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.staffListSelect }));
  }

  /** Invalidates any outstanding unused activation token and sends a fresh one. Never resends or reveals an old password. */
  async resendActivation(id: string, actor?: Actor) {
    const user = await this.requireStaffUser(id);
    const { hospitalId } = getTenantContext();

    await this.authService.sendActivationEmail({
      identifier: user.identifier,
      staffName: user.employee?.name ?? user.identifier,
      staffId: user.employee?.employeeId ?? null,
      role: user.role.name,
      hospitalId,
      actorUserId: actor?.id,
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor?.id ?? null,
        actorRole: actor?.roleName ?? 'System',
        action: 'staff.activation_resent',
        entityType: 'User',
        entityId: id,
      },
    });

    return { status: 'success', message: 'Activation email resent.' };
  }
}
