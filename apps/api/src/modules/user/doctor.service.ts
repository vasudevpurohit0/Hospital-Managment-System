import { Injectable } from '@nestjs/common';
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

      // Generate a hashed password for the new doctor (using bcrypt would be better, but mock it here if bcrypt is not imported, wait we can just use a dummy hash or import bcrypt)
      // Actually, since we're in a service, we could just put a dummy hash for now, but let's require bcryptjs.
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash('DoctorPass123!', 10);

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
      };
    });
  }
}
