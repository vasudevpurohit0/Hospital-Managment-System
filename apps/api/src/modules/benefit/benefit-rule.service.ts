import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BenefitOutcome, EmploymentTypeCode } from '@prisma/client';
import { CreateBenefitRuleDto } from './dto/create-benefit-rule.dto';
import { UpdateBenefitRuleDto } from './dto/update-benefit-rule.dto';

@Injectable()
export class BenefitRuleService {
  private readonly logger = new Logger(BenefitRuleService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Single Evaluator Engine used across prescription screen and pharmacy dispensing flow (Spec §7 & Module 8)
   */
  async evaluate(employmentTypeCode: string, medicineCategory?: string): Promise<BenefitOutcome> {
    const normCode = employmentTypeCode.toUpperCase().trim();
    const normCategory = medicineCategory?.trim() || null;

    // 1. Try exact match on employmentType + medicineCategory
    const exactRule = await this.prisma.benefitRule.findFirst({
      where: {
        employmentType: { code: normCode as EmploymentTypeCode },
        medicineCategory: normCategory,
        active: true,
      },
      orderBy: { version: 'desc' },
    });

    if (exactRule) return exactRule.outcome;

    // 2. Try wildcard rule (medicineCategory: null or blank)
    const wildcardRule = await this.prisma.benefitRule.findFirst({
      where: {
        employmentType: { code: normCode as EmploymentTypeCode },
        medicineCategory: null,
        active: true,
      },
      orderBy: { version: 'desc' },
    });

    if (wildcardRule) return wildcardRule.outcome;

    // Spec default fallback: Contractual -> Paid, Permanent -> Covered
    if (normCode.includes('CONTRACTUAL')) {
      return BenefitOutcome.PAID;
    }
    return BenefitOutcome.COVERED;
  }

  async findAll() {
    return this.prisma.benefitRule.findMany({
      include: { employmentType: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(dto: CreateBenefitRuleDto) {
    return this.prisma.benefitRule.create({
      data: {
        employmentTypeId: dto.employmentTypeId,
        medicineCategory: dto.medicineCategory || null,
        outcome: dto.outcome,
        active: dto.active ?? true,
        version: 1,
      },
      include: { employmentType: true },
    });
  }

  async update(id: string, dto: UpdateBenefitRuleDto) {
    const existing = await this.prisma.benefitRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`BenefitRule not found for ID: ${id}`);

    return this.prisma.benefitRule.update({
      where: { id },
      data: {
        medicineCategory:
          dto.medicineCategory !== undefined ? dto.medicineCategory : existing.medicineCategory,
        outcome: dto.outcome || existing.outcome,
        active: dto.active !== undefined ? dto.active : existing.active,
        version: existing.version + 1, // Rule versioning discipline
      },
      include: { employmentType: true },
    });
  }
}
