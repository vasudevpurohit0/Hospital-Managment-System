import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OpdTokenGeneratorService } from './opd-token-generator.service';
import { DepartmentService } from './department.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';

@Injectable()
export class OpdService {
  private readonly logger = new Logger(OpdService.name);

  constructor(
    private prisma: PrismaService,
    private tokenGenerator: OpdTokenGeneratorService,
    private departmentService: DepartmentService,
  ) {}

  /**
   * Create an OPD Visit record and issue an atomic daily queue token
   */
  async createOpdVisit(dto: CreateOpdVisitDto) {
    const dept = await this.departmentService.findById(dto.departmentId);
    if (!dept) {
      throw new NotFoundException(`Department not found for ID: ${dto.departmentId}`);
    }

    const tokenNumber = await this.tokenGenerator.generateDailyToken(dept.code);

    const opdVisit = await this.prisma.oPDVisit.create({
      data: {
        visitId: dto.visitId,
        departmentId: dept.id,
        tokenNumber,
      },
      include: {
        department: true,
        visit: {
          include: {
            employee: true,
          },
        },
      },
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
