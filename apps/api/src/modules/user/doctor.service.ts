import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { getTenantContext } from '../../common/tenant/tenant-context';
import { generateSecurePassword } from '../../common/security/password.util';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../../common/email/email.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { AccountLifecycleService, Actor, TEMP_PASSWORD_TTL_MS } from './account-lifecycle.service';

export type { Actor };

type DoctorUser = {
  id: string;
  identifier: string;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  doctorProfile: {
    id: string;
    specialty: string;
    experience: string;
    available: boolean;
    verified: boolean;
    departmentId: string | null;
    consultationFee: unknown;
    weeklySchedule: unknown;
    dutyStatus: string;
    dutyStatusChangedAt: Date | null;
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
    department: { id: string; name: string; code: string } | null;
  } | null;
  employee: { name: string; department: string; consultationRoom: string | null; contactPhone: string | null; employeeId?: string | null } | null;
};

export interface DoctorDto {
  id: string;
  name: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  dateJoined: Date;
  department: string;
  consultationRoom: string | null;
  contactPhone: string | null;
  specialty: string;
  experience: string;
  available: boolean;
  verified: boolean;
  departmentId: string | null;
  assignedDepartment: { id: string; name: string; code: string } | null;
  consultationFee: number;
  weeklySchedule: unknown;
  dutyStatus: string;
  dutyStatusChangedAt: Date | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
}

@Injectable()
export class DoctorService extends AccountLifecycleService<DoctorDto> {
  constructor(
    prisma: PrismaService,
    loginDirectory: LoginDirectoryService,
    private readonly sequences: DocumentSequenceService,
    authService: AuthService,
    emailService: EmailService,
  ) {
    super(prisma, loginDirectory, authService, emailService);
  }

  protected readonly accountKind = 'doctor';
  protected roleNameFor(): string {
    return 'Doctor';
  }

  protected readonly listSelect = {
    id: true,
    identifier: true,
    active: true,
    mustChangePassword: true,
    passwordChangedAt: true,
    lastLoginAt: true,
    createdAt: true,
    doctorProfile: {
      select: {
        id: true,
        specialty: true,
        experience: true,
        available: true,
        verified: true,
        departmentId: true,
        consultationFee: true,
        weeklySchedule: true,
        dutyStatus: true,
        dutyStatusChangedAt: true,
        checkedInAt: true,
        checkedOutAt: true,
        department: { select: { id: true, name: true, code: true } },
      },
    },
    employee: {
      select: { name: true, department: true, consultationRoom: true, contactPhone: true },
    },
  } as const;

  protected toDto(u: DoctorUser) {
    return {
      id: u.id,
      name: u.employee?.name ?? u.identifier,
      email: u.identifier,
      active: u.active,
      mustChangePassword: u.mustChangePassword,
      passwordChangedAt: u.passwordChangedAt,
      lastLoginAt: u.lastLoginAt,
      dateJoined: u.createdAt,
      department: u.employee?.department ?? 'General',
      consultationRoom: u.employee?.consultationRoom ?? null,
      contactPhone: u.employee?.contactPhone ?? null,
      specialty: u.doctorProfile?.specialty ?? 'General Physician',
      experience: u.doctorProfile?.experience ?? 'N/A',
      available: u.doctorProfile?.available ?? true,
      verified: u.doctorProfile?.verified ?? false,
      departmentId: u.doctorProfile?.departmentId ?? null,
      assignedDepartment: u.doctorProfile?.department ?? null,
      consultationFee: u.doctorProfile?.consultationFee != null ? Number(u.doctorProfile.consultationFee) : 0,
      weeklySchedule: u.doctorProfile?.weeklySchedule ?? null,
      dutyStatus: u.doctorProfile?.dutyStatus ?? 'OFF_DUTY',
      dutyStatusChangedAt: u.doctorProfile?.dutyStatusChangedAt ?? null,
      checkedInAt: u.doctorProfile?.checkedInAt ?? null,
      checkedOutAt: u.doctorProfile?.checkedOutAt ?? null,
    };
  }

  async findAllDoctors() {
    const doctors = await this.prisma.user.findMany({
      where: { active: true, role: { name: 'Doctor' }, doctorProfile: { isNot: null } },
      select: this.listSelect,
      orderBy: [{ doctorProfile: { specialty: 'asc' } }, { employee: { name: 'asc' } }],
    });
    return doctors.map((u) => this.toDto(u));
  }

  /**
   * Backs the OPD registration doctor picker: active, Doctor role, has a
   * profile, and belongs to the requested department (primary department or
   * an additional `DoctorDepartment` row).
   */
  async findEligibleDoctors(departmentId: string) {
    const doctors = await this.prisma.user.findMany({
      where: {
        active: true,
        role: { name: 'Doctor' },
        // A plain field filter here (no `isNot: null` needed) already
        // requires a matching profile to exist -- a null profile can't
        // satisfy either branch of the OR.
        doctorProfile: {
          OR: [{ departmentId }, { departments: { some: { departmentId } } }],
        },
      },
      select: this.listSelect,
      orderBy: [{ employee: { name: 'asc' } }],
    });
    return doctors.map((u) => this.toDto(u));
  }

  /**
   * Among the doctors eligible for this department, picks the one with the
   * fewest currently-active (WAITING/CALLED/IN_CONSULTATION) OPDVisit rows
   * -- an optional convenience for OPD registration ("auto-assign to
   * least-busy doctor"), never the default. Returns null if no doctor is
   * eligible.
   */
  async findLeastBusyEligibleDoctor(departmentId: string) {
    const eligible = await this.findEligibleDoctors(departmentId);
    if (eligible.length === 0) return null;

    const counts = await this.prisma.oPDVisit.groupBy({
      by: ['doctorId'],
      where: { doctorId: { in: eligible.map((d) => d.id) }, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } },
      _count: { _all: true },
    });
    const countByDoctor = new Map(counts.map((c) => [c.doctorId, c._count._all]));

    return eligible.reduce((least, doctor) => {
      const doctorCount = countByDoctor.get(doctor.id) ?? 0;
      const leastCount = countByDoctor.get(least.id) ?? 0;
      return doctorCount < leastCount ? doctor : least;
    });
  }

  /** Admin roster: includes deactivated doctors too, so they can be reactivated. */
  async findAllDoctorsForAdmin() {
    const doctors = await this.prisma.user.findMany({
      where: { role: { name: 'Doctor' }, doctorProfile: { isNot: null } },
      select: this.listSelect,
      orderBy: [{ doctorProfile: { specialty: 'asc' } }, { employee: { name: 'asc' } }],
    });
    const identifiers = doctors.map((d) => d.identifier);
    const statuses = await this.loginDirectory.getStatuses(identifiers);
    return doctors.map((u) => {
      const status = statuses.get(u.identifier.trim().toLowerCase());
      return {
        ...this.toDto(u),
        locked: !!(status?.manuallyLockedAt || (status?.lockedUntil && status.lockedUntil > new Date())),
        failedLoginAttempts: status?.failedAttempts ?? 0,
      };
    });
  }

  async createDoctor(data: CreateDoctorDto, actor?: Actor) {
    const email = data.email.trim().toLowerCase();

    // Register in the global login directory FIRST: the tenant-schema
    // transaction below and this platform-schema write can't share one
    // transaction (different databases), so failing fast here means a
    // colliding identifier never gets an orphaned tenant user created for it.
    const { hospitalId } = getTenantContext();
    await this.loginDirectory.register(email, hospitalId);

    let created: Awaited<ReturnType<typeof this.createDoctorInTenant>>;
    try {
      created = await this.createDoctorInTenant(data, email, actor);
    } catch (err) {
      // The tenant user was never created (transaction failed), so undo the
      // directory registration rather than leaving a dangling identifier
      // that can never be used.
      await this.loginDirectory.remove(email).catch(() => undefined);
      throw err;
    }

    // Deliberately after the transaction commits, not inside it.
    await this.sendCredentialEmails({
      identifier: created.email,
      staffName: created.name,
      staffId: created.staffId,
      role: 'Doctor',
      hospitalId,
      actorUserId: this.actorTenantUserId(actor) ?? undefined,
      temporaryPassword: created.temporaryPassword,
    });

    return created;
  }

  private async createDoctorInTenant(data: CreateDoctorDto, email: string, actor?: Actor) {
    return this.prisma.$transaction(async (tx) => {
      let doctorRole = await tx.role.findUnique({ where: { name: 'Doctor' } });
      if (!doctorRole) {
        doctorRole = await tx.role.create({ data: { name: 'Doctor', isSystemRole: true } });
      }

      // A fresh, random one-time password per account, generated by the
      // shared secure generator (guarantees mixed case/digits/symbols, never
      // a fixed/predictable string). It is returned once below so the
      // administrator creating the account can hand it to the doctor; it is
      // never stored or logged in plaintext -- only its bcrypt hash is
      // persisted, and the doctor must change it before reaching any other
      // endpoint (mustChangePassword, enforced by RbacGuard).
      const temporaryPassword = generateSecurePassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      const user = await tx.user.create({
        data: {
          identifier: email,
          passwordHash,
          roleId: doctorRole.id,
          active: true,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
        },
      });

      const empId = await this.sequences.nextStaffId('DOC', tx);

      const post = (await tx.post.findFirst({ where: { title: 'Senior Officer' } })) || (await tx.post.findFirst());
      const grade = (await tx.grade.findFirst({ where: { payLevel: 'Pay Level 10' } })) || (await tx.grade.findFirst());
      const empType =
        (await tx.employmentType.findFirst({ where: { code: 'PERMANENT' } })) || (await tx.employmentType.findFirst());

      if (!post || !grade || !empType) {
        throw new Error('Master data for employee creation is missing (Post/Grade/EmpType)');
      }

      const employee = await tx.employee.create({
        data: {
          employeeId: empId,
          name: data.name,
          department: data.specialty,
          postId: post.id,
          gradeId: grade.id,
          employmentTypeId: empType.id,
          contactEmail: email,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { employeeId: employee.id },
      });

      const profile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          specialty: data.specialty,
          experience: data.experience,
          available: true,
          departmentId: data.departmentId,
          consultationFee: data.consultationFee ?? 0,
          weeklySchedule: data.weeklySchedule ? (data.weeklySchedule as object[]) : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: this.actorTenantUserId(actor),
          actorRole: actor?.roleName ?? 'System',
          action: 'doctor.created',
          entityType: 'User',
          entityId: user.id,
          afterSnapshot: { email, name: data.name, specialty: data.specialty, staffId: empId },
        },
      });

      return {
        id: user.id,
        name: employee.name,
        specialty: profile.specialty,
        experience: profile.experience,
        available: profile.available,
        departmentId: profile.departmentId,
        consultationFee: Number(profile.consultationFee),
        weeklySchedule: profile.weeklySchedule,
        email,
        staffId: empId,
        temporaryPassword,
      };
    });
  }

  protected async requireAccountUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { doctorProfile: true, employee: true },
    });
    if (!user || !user.doctorProfile) {
      throw new NotFoundException(`Doctor not found: ${id}`);
    }
    return user;
  }

  async updateDoctor(id: string, dto: UpdateDoctorDto, actor?: Actor) {
    const user = await this.requireAccountUser(id);

    await this.prisma.$transaction(async (tx) => {
      if (dto.name && user.employeeId) {
        await tx.employee.update({ where: { id: user.employeeId }, data: { name: dto.name } });
      }

      // Email change updates the login identifier too -- rename in the
      // directory first (throws ConflictException on collision, same as
      // register), then the tenant User row, so the two never disagree.
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
              actorUserId: this.actorTenantUserId(actor),
              actorRole: actor?.roleName ?? 'System',
              action: 'doctor.email_changed',
              entityType: 'User',
              entityId: id,
              beforeSnapshot: { email: oldEmail },
              afterSnapshot: { email: newEmail },
            },
          });
        }
      }

      const departmentChanged = dto.departmentId !== undefined && dto.departmentId !== user.doctorProfile!.departmentId;

      await tx.doctorProfile.update({
        where: { userId: id },
        data: {
          specialty: dto.specialty,
          experience: dto.experience,
          departmentId: dto.departmentId === undefined ? undefined : dto.departmentId,
          consultationFee: dto.consultationFee,
          verified: dto.verified,
          weeklySchedule: dto.weeklySchedule ? (dto.weeklySchedule as object[]) : undefined,
        },
      });

      if (departmentChanged) {
        await tx.auditLog.create({
          data: {
            actorUserId: this.actorTenantUserId(actor),
            actorRole: actor?.roleName ?? 'System',
            action: 'doctor.department_changed',
            entityType: 'DoctorProfile',
            entityId: user.doctorProfile!.id,
            beforeSnapshot: { departmentId: user.doctorProfile!.departmentId },
            afterSnapshot: { departmentId: dto.departmentId },
          },
        });
      }
    });

    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.listSelect });
    return this.toDto(updated);
  }

  /**
   * Self-service duty status (check-in/check-out/break) -- always acts on
   * the calling doctor's own profile (`userId` comes from the JWT, never a
   * client-supplied id), unlike every other method in this service which is
   * admin-only. Returns just the four status fields, not the full DTO.
   */
  async getDutyStatus(userId: string) {
    const profile = await this.prisma.doctorProfile.findUniqueOrThrow({
      where: { userId },
      select: { dutyStatus: true, dutyStatusChangedAt: true, checkedInAt: true, checkedOutAt: true },
    });
    return profile;
  }

  private async assertNoActiveVisit(userId: string, action: string) {
    const activeVisit = await this.prisma.oPDVisit.findFirst({
      where: { doctorId: userId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
    });
    if (activeVisit) {
      throw new BadRequestException(`Complete, skip, or transfer your current patient before ${action}.`);
    }
  }

  async checkIn(userId: string, actor?: Actor) {
    const user = await this.requireAccountUser(userId);
    if (user.doctorProfile!.dutyStatus !== 'OFF_DUTY') {
      throw new BadRequestException('You are already checked in.');
    }
    const now = new Date();
    await this.prisma.doctorProfile.update({
      where: { userId },
      data: { dutyStatus: 'AVAILABLE', checkedInAt: now, dutyStatusChangedAt: now },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: actor?.id ?? userId, actorRole: actor?.roleName ?? 'Doctor', action: 'doctor.checked_in', entityType: 'User', entityId: userId },
    });
    return this.getDutyStatus(userId);
  }

  async checkOut(userId: string, actor?: Actor) {
    const user = await this.requireAccountUser(userId);
    if (user.doctorProfile!.dutyStatus === 'OFF_DUTY') {
      throw new BadRequestException('You are already checked out.');
    }
    await this.assertNoActiveVisit(userId, 'checking out');
    const now = new Date();
    await this.prisma.doctorProfile.update({
      where: { userId },
      data: { dutyStatus: 'OFF_DUTY', checkedOutAt: now, dutyStatusChangedAt: now },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: actor?.id ?? userId, actorRole: actor?.roleName ?? 'Doctor', action: 'doctor.checked_out', entityType: 'User', entityId: userId },
    });
    return this.getDutyStatus(userId);
  }

  async startBreak(userId: string, actor?: Actor) {
    const user = await this.requireAccountUser(userId);
    if (user.doctorProfile!.dutyStatus === 'OFF_DUTY') {
      throw new BadRequestException('Check in before starting a break.');
    }
    if (user.doctorProfile!.dutyStatus === 'ON_BREAK') {
      throw new BadRequestException('You are already on a break.');
    }
    await this.assertNoActiveVisit(userId, 'going on a break');
    const now = new Date();
    await this.prisma.doctorProfile.update({
      where: { userId },
      data: { dutyStatus: 'ON_BREAK', dutyStatusChangedAt: now },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: actor?.id ?? userId, actorRole: actor?.roleName ?? 'Doctor', action: 'doctor.break_started', entityType: 'User', entityId: userId },
    });
    return this.getDutyStatus(userId);
  }

  async endBreak(userId: string, actor?: Actor) {
    const user = await this.requireAccountUser(userId);
    if (user.doctorProfile!.dutyStatus !== 'ON_BREAK') {
      throw new BadRequestException('You are not currently on a break.');
    }
    const now = new Date();
    await this.prisma.doctorProfile.update({
      where: { userId },
      data: { dutyStatus: 'AVAILABLE', dutyStatusChangedAt: now },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: actor?.id ?? userId, actorRole: actor?.roleName ?? 'Doctor', action: 'doctor.break_ended', entityType: 'User', entityId: userId },
    });
    return this.getDutyStatus(userId);
  }
}
