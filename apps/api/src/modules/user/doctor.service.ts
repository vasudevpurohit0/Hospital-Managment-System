import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { getTenantContext } from '../../common/tenant/tenant-context';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginDirectory: LoginDirectoryService,
  ) {}

  private readonly doctorListSelect = {
    id: true,
    identifier: true,
    active: true,
    doctorProfile: {
      select: {
        id: true,
        specialty: true,
        experience: true,
        available: true,
        departmentId: true,
        consultationFee: true,
        weeklySchedule: true,
        department: { select: { id: true, name: true, code: true } },
      },
    },
    employee: {
      select: { name: true, department: true },
    },
  } as const;

  private toDto(u: {
    id: string;
    identifier: string;
    active: boolean;
    doctorProfile: {
      id: string;
      specialty: string;
      experience: string;
      available: boolean;
      departmentId: string | null;
      consultationFee: unknown;
      weeklySchedule: unknown;
      department: { id: string; name: string; code: string } | null;
    } | null;
    employee: { name: string; department: string } | null;
  }) {
    return {
      id: u.id,
      name: u.employee?.name ?? u.identifier,
      email: u.identifier,
      active: u.active,
      department: u.employee?.department ?? 'General',
      specialty: u.doctorProfile?.specialty ?? 'General Physician',
      experience: u.doctorProfile?.experience ?? 'N/A',
      available: u.doctorProfile?.available ?? true,
      departmentId: u.doctorProfile?.departmentId ?? null,
      assignedDepartment: u.doctorProfile?.department ?? null,
      consultationFee: u.doctorProfile?.consultationFee != null ? Number(u.doctorProfile.consultationFee) : 0,
      weeklySchedule: u.doctorProfile?.weeklySchedule ?? null,
    };
  }

  async findAllDoctors() {
    const doctors = await this.prisma.user.findMany({
      where: { active: true, role: { name: 'Doctor' }, doctorProfile: { isNot: null } },
      select: this.doctorListSelect,
      orderBy: [{ doctorProfile: { specialty: 'asc' } }, { employee: { name: 'asc' } }],
    });
    return doctors.map((u) => this.toDto(u));
  }

  /** Admin roster: includes deactivated doctors too, so they can be reactivated. */
  async findAllDoctorsForAdmin() {
    const doctors = await this.prisma.user.findMany({
      where: { role: { name: 'Doctor' }, doctorProfile: { isNot: null } },
      select: this.doctorListSelect,
      orderBy: [{ doctorProfile: { specialty: 'asc' } }, { employee: { name: 'asc' } }],
    });
    return doctors.map((u) => this.toDto(u));
  }

  async createDoctor(data: CreateDoctorDto) {
    // Register in the global login directory FIRST: the tenant-schema
    // transaction below and this platform-schema write can't share one
    // transaction (different databases), so failing fast here means a
    // colliding identifier never gets an orphaned tenant user created for it.
    const { hospitalId } = getTenantContext();
    await this.loginDirectory.register(data.email, hospitalId);

    try {
      return await this.createDoctorInTenant(data);
    } catch (err) {
      // The tenant user was never created (transaction failed), so undo the
      // directory registration rather than leaving a dangling identifier
      // that can never be used.
      await this.loginDirectory.remove(data.email).catch(() => undefined);
      throw err;
    }
  }

  private async createDoctorInTenant(data: CreateDoctorDto) {
    return this.prisma.$transaction(async (tx) => {
      let doctorRole = await tx.role.findUnique({ where: { name: 'Doctor' } });
      if (!doctorRole) {
        doctorRole = await tx.role.create({ data: { name: 'Doctor', isSystemRole: true } });
      }

      // A fresh, random one-time password per account — the previous code used
      // the literal string "DoctorPass123!" for every doctor ever created here,
      // which meant every self-service-onboarded doctor shared one publicly
      // guessable login. It is returned once below so the administrator
      // creating the account can hand it to the doctor; it is never stored or
      // logged in plaintext.
      const temporaryPassword = randomBytes(9).toString('base64url');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      const user = await tx.user.create({
        data: {
          identifier: data.email,
          passwordHash,
          roleId: doctorRole.id,
          active: true,
        },
      });

      const empId = `DOC-${data.email.split('@')[0]}`;

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
          contactEmail: data.email,
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

      return {
        id: user.id,
        name: employee.name,
        specialty: profile.specialty,
        experience: profile.experience,
        available: profile.available,
        departmentId: profile.departmentId,
        consultationFee: Number(profile.consultationFee),
        weeklySchedule: profile.weeklySchedule,
        temporaryPassword,
      };
    });
  }

  private async requireDoctorUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { doctorProfile: true, employee: true },
    });
    if (!user || !user.doctorProfile) {
      throw new NotFoundException(`Doctor not found: ${id}`);
    }
    return user;
  }

  async updateDoctor(id: string, dto: UpdateDoctorDto) {
    const user = await this.requireDoctorUser(id);

    if (dto.name && user.employeeId) {
      await this.prisma.employee.update({ where: { id: user.employeeId }, data: { name: dto.name } });
    }

    await this.prisma.doctorProfile.update({
      where: { userId: id },
      data: {
        specialty: dto.specialty,
        experience: dto.experience,
        departmentId: dto.departmentId === undefined ? undefined : dto.departmentId,
        consultationFee: dto.consultationFee,
        weeklySchedule: dto.weeklySchedule ? (dto.weeklySchedule as object[]) : undefined,
      },
    });

    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: this.doctorListSelect });
    return this.toDto(updated);
  }

  /** Deactivates (never hard-deletes -- heavily FK-referenced by historical visits/admissions). */
  async setActive(id: string, active: boolean) {
    await this.requireDoctorUser(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { active },
      select: this.doctorListSelect,
    });
    return this.toDto(user);
  }
}
