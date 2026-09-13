import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllDoctors() {
    const doctors = await this.prisma.user.findMany({
      where: {
        active: true,
        role: { name: 'Doctor' },
        doctorProfile: { isNot: null },
      },
      select: {
        id: true,
        identifier: true,
        doctorProfile: {
          select: {
            id: true,
            specialty: true,
            experience: true,
            timing: true,
            available: true,
          },
        },
        employee: {
          select: { name: true, department: true },
        },
      },
      orderBy: [
        { doctorProfile: { specialty: 'asc' } },
        { employee: { name: 'asc' } },
      ],
    });

    return doctors.map((u) => ({
      id: u.id,
      name: u.employee?.name ?? u.identifier,
      department: u.employee?.department ?? 'General',
      specialty: u.doctorProfile?.specialty ?? 'General Physician',
      experience: u.doctorProfile?.experience ?? 'N/A',
      timing: u.doctorProfile?.timing ?? 'N/A',
      available: u.doctorProfile?.available ?? true,
    }));
  }

  async createDoctor(data: { name: string; specialty: string; experience: string; timing: string; email: string }) {
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
      
      const post = await tx.post.findFirst({ where: { title: 'Senior Officer' } }) || await tx.post.findFirst();
      const grade = await tx.grade.findFirst({ where: { payLevel: 'Pay Level 10' } }) || await tx.grade.findFirst();
      const empType = await tx.employmentType.findFirst({ where: { code: 'PERMANENT' } }) || await tx.employmentType.findFirst();

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
          timing: data.timing,
          available: true,
        },
      });

      return {
        id: user.id,
        name: employee.name,
        specialty: profile.specialty,
        experience: profile.experience,
        timing: profile.timing,
        available: profile.available,
        temporaryPassword,
      };
    });
  }
}
