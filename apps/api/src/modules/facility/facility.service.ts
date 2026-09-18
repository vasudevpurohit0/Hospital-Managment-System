import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacilityCategory } from '@prisma/client';
import { CreateFacilityRuleDto } from './dto/create-facility-rule.dto';

// Default FacilityEligibilityRules used to be seeded here via OnModuleInit
// (a startup "if empty, seed" check against app-process boot). That is now
// redundant AND unsafe: prisma/seed.ts already seeds an equivalent (in fact
// more complete, deterministic-id) rule set per tenant schema (see its
// "Seed FacilityEligibilityRules" section), and there is no single "the"
// database to run a boot-time check against anymore now that each hospital
// has its own schema.
@Injectable()
export class FacilityEligibilityService {
  private readonly logger = new Logger(FacilityEligibilityService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Resolves eligible ward/room category for an employee using ONLY data lookups. (No hardcoded conditionals)
   */
  async resolve(employeeId: string) {
    // Look up employee by UUID or official employee_id
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [{ id: employeeId }, { employeeId: employeeId }],
      },
      include: {
        post: true,
        grade: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee not found for ID: ${employeeId}`);
    }

    // 1. Try to find active rule matching gradeId
    let rule = await this.prisma.facilityEligibilityRule.findFirst({
      where: {
        gradeId: employee.gradeId,
        active: true,
      },
      orderBy: { version: 'desc' },
    });

    // 2. Try to find active rule matching postId (and gradeId is null)
    if (!rule) {
      rule = await this.prisma.facilityEligibilityRule.findFirst({
        where: {
          postId: employee.postId,
          gradeId: null,
          active: true,
        },
        orderBy: { version: 'desc' },
      });
    }

    if (!rule) {
      throw new NotFoundException(
        `No active FacilityEligibilityRule found for employee post/grade`,
      );
    }

    return {
      category: rule.category,
      wardEligibility: rule.wardEligibility,
      room: rule.room,
      facilityLevel: rule.facilityLevel,
      ruleId: rule.id,
      version: rule.version,
    };
  }

  async findAll() {
    return this.prisma.facilityEligibilityRule.findMany({
      include: {
        post: true,
        grade: true,
      },
      orderBy: [{ postId: 'asc' }, { version: 'desc' }],
    });
  }

  async create(dto: CreateFacilityRuleDto, userId?: string) {
    return this.prisma.facilityEligibilityRule.create({
      data: {
        postId: dto.postId || null,
        gradeId: dto.gradeId || null,
        category: dto.category as FacilityCategory,
        wardEligibility: dto.wardEligibility,
        room: dto.room,
        facilityLevel: dto.facilityLevel,
        active: dto.active ?? true,
        version: 1,
        createdById: userId || null,
      },
      include: {
        post: true,
        grade: true,
      },
    });
  }

  /**
   * Editing a rule creates a new version rather than overwriting (Spec §9 & FR-FAC-04)
   */
  async update(id: string, dto: CreateFacilityRuleDto, userId?: string) {
    const existingRule = await this.prisma.facilityEligibilityRule.findUnique({
      where: { id },
    });

    if (!existingRule) {
      throw new NotFoundException(`FacilityEligibilityRule with ID ${id} not found`);
    }

    // 1. Mark existing version as inactive
    await this.prisma.facilityEligibilityRule.update({
      where: { id },
      data: { active: false },
    });

    // 2. Create a new rule version
    return this.prisma.facilityEligibilityRule.create({
      data: {
        postId: existingRule.postId,
        gradeId: existingRule.gradeId,
        category: dto.category as FacilityCategory,
        wardEligibility: dto.wardEligibility,
        room: dto.room,
        facilityLevel: dto.facilityLevel,
        active: true,
        version: existingRule.version + 1,
        createdById: userId || null,
      },
      include: {
        post: true,
        grade: true,
      },
    });
  }
}
