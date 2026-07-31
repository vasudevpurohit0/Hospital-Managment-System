import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export const SEED_DEPARTMENTS = [
  { name: 'Cardiology', code: 'CARDIO' },
  { name: 'Orthopedics', code: 'ORTHO' },
  { name: 'General Medicine', code: 'GENMED' },
  { name: 'Pediatrics', code: 'PEDIATRIC' },
  { name: 'Dermatology', code: 'DERMA' },
  { name: 'ENT (Ear, Nose, Throat)', code: 'ENT' },
];

const isUuid = (str: string) =>
  typeof str === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

@Injectable()
export class DepartmentService implements OnModuleInit {
  private readonly logger = new Logger(DepartmentService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    for (const d of SEED_DEPARTMENTS) {
      const existing = await this.prisma.department.findUnique({ where: { code: d.code } });
      if (!existing) {
        await this.prisma.department.create({ data: d });
      }
    }
    this.logger.log('✅ Seeded default clinical departments');
  }

  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    if (isUuid(id)) {
      const dept = await this.prisma.department.findUnique({ where: { id } });
      if (dept) return dept;
    }
    const normalizedCode = id
      .replace(/^dept-/, '')
      .replace(/_/g, '')
      .toUpperCase();
    const deptByCode = await this.prisma.department.findFirst({
      where: {
        OR: [
          { code: { equals: normalizedCode, mode: 'insensitive' } },
          { code: { contains: normalizedCode.slice(0, 4), mode: 'insensitive' } },
        ],
      },
    });
    return deptByCode || null;
  }
}
