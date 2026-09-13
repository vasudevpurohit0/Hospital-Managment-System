import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OpdTokenGeneratorService } from './opd-token-generator.service';
import { DepartmentService } from './department.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';
import { ChargeService } from '../../billing/charge.service';
import { BenefitRuleService } from '../../benefit/benefit-rule.service';
import { DocumentSequenceService } from '../../../common/sequence/document-sequence.service';

/** The consultation service auto-charged on every OPD visit, once priced. */
const OPD_CONSULTATION_SERVICE_CODE = 'CONSULT-GEN';

@Injectable()
export class OpdService {
  private readonly logger = new Logger(OpdService.name);

  constructor(
    private prisma: PrismaService,
    private tokenGenerator: OpdTokenGeneratorService,
    private departmentService: DepartmentService,
    private chargeService: ChargeService,
    private benefitRuleService: BenefitRuleService,
    private sequences: DocumentSequenceService,
  ) {}

  /**
   * Create an OPD Visit record and issue an atomic daily queue token
   */
  async createOpdVisit(dto: CreateOpdVisitDto) {
    const dept = await this.departmentService.findById(dto.departmentId);
    if (!dept) {
      throw new NotFoundException(`Department not found for ID: ${dto.departmentId}`);
    }

    // Token, visit and (if priced) the consultation charge are written
    // together: if any step fails, the token is rolled back instead of
    // leaving a hole in the day's sequence, and no charge can exist for an
    // OPDVisit that doesn't.
    const { opdVisit, tokenNumber } = await this.prisma.$transaction(async (tx) => {
      const issuedToken = await this.tokenGenerator.generateDailyToken(dept.code, tx);

      // Permanent OPD number, distinct from the daily queue token — Feature
      // 11 searches by both as separate identifiers.
      const opdNumber = await this.sequences.next('OPD_NUMBER', tx);

      const created = await tx.oPDVisit.create({
        data: {
          visitId: dto.visitId,
          departmentId: dept.id,
          tokenNumber: issuedToken,
          opdNumber,
        },
        include: {
          department: true,
          visit: {
            include: {
              employee: { include: { employmentType: true } },
            },
          },
        },
      });

      // Best-effort: CONSULT-GEN is seeded with no rate (no ESIC consultation
      // fee is published in the reference material), so this quietly skips
      // rather than blocking OPD visit creation. The moment an administrator
      // prices it, new visits start charging automatically — no code change
      // needed. Uses the benefit evaluator's employment-type wildcard, the
      // same default that already governs medicine charges, rather than
      // inventing a second rule engine for non-medicine services.
      const consultationService = await tx.service.findUnique({
        where: { code: OPD_CONSULTATION_SERVICE_CODE },
      });
      if (consultationService) {
        const outcome = await this.benefitRuleService.evaluate(
          created.visit.employee.employmentType.code,
        );
        await this.chargeService.postServiceChargeIfPriced(
          { visitId: dto.visitId, serviceId: consultationService.id },
          outcome,
          tx,
        );
      }

      return { opdVisit: created, tokenNumber: issuedToken };
    });

    this.logger.log(`✅ Created OPDVisit ${opdVisit.id} with token ${tokenNumber}`);
    return {
      status: 'CREATED',
      opdVisit,
      tokenNumber,
    };
  }

  /**
   * Fetch current queue for a department (waiting & called tokens)
   */
  async getQueue(departmentId: string) {
    const dept = await this.departmentService.findById(departmentId);
    const targetDeptId = dept?.id || departmentId;

    return this.prisma.oPDVisit.findMany({
      where: {
        departmentId: targetDeptId,
        closedAt: null,
      },
      include: {
        department: true,
        visit: {
          include: {
            employee: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Mark token called by attending doctor
   */
  async callToken(id: string) {
    const calledAt = new Date();

    const targetVisit = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!targetVisit) {
      throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    }

    await this.prisma.oPDVisit.updateMany({
      where: {
        departmentId: targetVisit.departmentId,
        calledAt: { not: null },
        closedAt: null,
        id: { not: id },
      },
      data: {
        closedAt: calledAt,
      },
    });

    return this.prisma.oPDVisit.update({
      where: { id },
      data: { calledAt },
      include: { department: true, visit: { include: { employee: true } } },
    });
  }

  /**
   * Mark visit closed
   */
  async closeOpdVisit(id: string) {
    const closedAt = new Date();

    const existing = await this.prisma.oPDVisit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
    }

    return this.prisma.oPDVisit.update({
      where: { id },
      data: {
        closedAt,
        visit: {
          update: {
            status: 'CLOSED',
            closedAt,
          },
        },
      },
      include: { department: true, visit: true },
    });
  }
}
