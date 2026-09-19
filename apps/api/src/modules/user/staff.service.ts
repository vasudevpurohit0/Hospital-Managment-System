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
import { AccountLifecycleService, Actor, TEMP_PASSWORD_TTL_MS } from './account-lifecycle.service';

export type { Actor };

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
  departmentAssignments: { isPrimary: boolean; department: { id: string; name: string; code: string } }[];
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
      select: this.listSelect,
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
    const user = await this.requireAccountUser(id);
    return this.toDto(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: this.listSelect }));
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

    return this.toDto(await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.listSelect }));
  }

}
