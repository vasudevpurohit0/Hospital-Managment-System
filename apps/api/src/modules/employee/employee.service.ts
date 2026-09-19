import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSimpleDto } from './dto/create-employee-simple.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmploymentTypeCode } from '@prisma/client';

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService) {}

  /** Plain-text create used by the Employee Directory screen — resolves
   *  Post/Grade/EmploymentType by name, creating them if they don't exist
   *  yet, then delegates to the same create() path as the ID-based API. */
  async createSimple(dto: CreateEmployeeSimpleDto) {
    const existing = await this.prisma.employee.findUnique({
      where: { employeeId: dto.employeeId },
    });
    if (existing) {
      throw new ConflictException(`Employee with ID ${dto.employeeId} already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      let post = await tx.post.findUnique({ where: { title: dto.postTitle } });
      if (!post) {
        post = await tx.post.create({ data: { title: dto.postTitle } });
      }

      let grade = await tx.grade.findFirst({ where: { payLevel: dto.gradePayLevel } });
      if (!grade) {
        grade = await tx.grade.create({ data: { payLevel: dto.gradePayLevel, postId: post.id } });
      }

      let employmentType = await tx.employmentType.findUnique({
        where: { code: dto.employmentTypeCode as EmploymentTypeCode },
      });
      if (!employmentType) {
        employmentType = await tx.employmentType.create({
          data: { code: dto.employmentTypeCode as EmploymentTypeCode, name: `${dto.employmentTypeCode} Employee` },
        });
      }

      return tx.employee.create({
        data: {
          employeeId: dto.employeeId,
          name: dto.name,
          department: dto.department,
          postId: post.id,
          gradeId: grade.id,
          employmentTypeId: employmentType.id,
          contactPhone: dto.contactPhone || null,
          contactEmail: dto.contactEmail || null,
        },
        include: { post: true, grade: true, employmentType: true },
      });
    });
  }

  async create(createEmployeeDto: CreateEmployeeDto) {
    const existing = await this.prisma.employee.findUnique({
      where: { employeeId: createEmployeeDto.employeeId },
    });

    if (existing) {
      throw new ConflictException(
        `Employee with ID ${createEmployeeDto.employeeId} already exists`,
      );
    }

    return this.prisma.employee.create({
      data: createEmployeeDto,
      include: {
        post: true,
        grade: true,
        employmentType: true,
      },
    });
  }

  async findAll() {
    return this.prisma.employee.findMany({
      include: {
        post: true,
        grade: true,
        employmentType: true,
        hospitalUid: true,
      },
    });
  }

  /** Distinct Post titles and Grade pay levels already on file, for the
   *  Employee Directory's Add Employee form to offer as autocomplete
   *  suggestions instead of free-typing near-duplicates like "Clerk" /
   *  "clerk" / "Clerk " into separate Post records. */
  async getPostGradeOptions() {
    const [posts, grades] = await Promise.all([
      this.prisma.post.findMany({ select: { title: true }, orderBy: { title: 'asc' } }),
      this.prisma.grade.findMany({ select: { payLevel: true }, distinct: ['payLevel'], orderBy: { payLevel: 'asc' } }),
    ]);
    return {
      posts: posts.map((p) => p.title),
      grades: grades.map((g) => g.payLevel),
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        post: true,
        grade: true,
        employmentType: true,
        hospitalUid: true,
        patientProfile: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async update(id: string, updateDto: UpdateEmployeeDto) {
    await this.findOne(id);

    // Explicit allowlist, not `data: updateDto` -- defense in depth on top
    // of the real DTO class + global ValidationPipe (whitelist,
    // forbidNonWhitelisted) that already validates this body, matching the
    // pattern used in doctor.service.ts/staff.service.ts.
    return this.prisma.employee.update({
      where: { id },
      data: {
        name: updateDto.name,
        department: updateDto.department,
        postId: updateDto.postId,
        gradeId: updateDto.gradeId,
        employmentTypeId: updateDto.employmentTypeId,
        contactPhone: updateDto.contactPhone,
        contactEmail: updateDto.contactEmail,
      },
      include: {
        post: true,
        grade: true,
        employmentType: true,
      },
    });
  }
}
