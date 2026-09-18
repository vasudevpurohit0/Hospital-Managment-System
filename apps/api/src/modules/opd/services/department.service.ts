import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';

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

// Default departments are seeded per-tenant-schema by prisma/seed.ts (which
// imports SEED_DEPARTMENTS from here), not at app-process boot: there is no
// single "the" database to seed into anymore now that each hospital has its
// own schema.
@Injectable()
export class DepartmentService {
  private readonly logger = new Logger(DepartmentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * `includeInactive` defaults to false because this method backs the OPD
   * registration department dropdown (via DepartmentController.findAll(),
   * unrestricted to Employee:read) -- a deactivated department must vanish
   * from there immediately. The admin roster screen passes true explicitly
   * so it can still see (and reactivate) deactivated ones.
   */
  async findAll(includeInactive = false) {
    return this.prisma.department.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  private async requireDepartment(id: string) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException(`Department not found: ${id}`);
    return department;
  }

  private async assertNameCodeAvailable(name: string, code: string, excludeId?: string) {
    const existing = await this.prisma.department.findFirst({
      where: { OR: [{ name }, { code }], NOT: excludeId ? { id: excludeId } : undefined },
    });
    if (existing) {
      const field = existing.name === name ? `name "${name}"` : `code "${code}"`;
      throw new ConflictException(`A department with ${field} already exists.`);
    }
  }

  async create(dto: CreateDepartmentDto) {
    await this.assertNameCodeAvailable(dto.name, dto.code);
    return this.prisma.department.create({ data: { name: dto.name, code: dto.code } });
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const department = await this.requireDepartment(id);
    await this.assertNameCodeAvailable(dto.name ?? department.name, dto.code ?? department.code, id);
    return this.prisma.department.update({
      where: { id },
      data: { name: dto.name, code: dto.code },
    });
  }

  /**
   * Deactivates (never hard-deletes -- historical OPDVisit rows keep
   * resolving it). Blocked if it's the hospital's only active department,
   * since the OPD registration dropdown would otherwise have nothing to
   * offer for a brand-new visit.
   */
  async setActive(id: string, active: boolean) {
    await this.requireDepartment(id);
    if (!active) {
      const activeCount = await this.prisma.department.count({ where: { active: true } });
      if (activeCount <= 1) {
        throw new BadRequestException('Cannot deactivate the only remaining active department.');
      }
    }
    return this.prisma.department.update({ where: { id }, data: { active } });
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
