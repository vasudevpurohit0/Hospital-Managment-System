import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { VisitStatus } from '@prisma/client';

@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  constructor(private prisma: PrismaService) {}

  async createVisit(dto: CreateVisitDto) {
    const trimmedId = dto.employeeId.trim();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId);
    const orConditions: any[] = [
      { employeeId: { equals: trimmedId, mode: 'insensitive' } },
      { hospitalUid: { uidCode: { equals: trimmedId, mode: 'insensitive' } } },
    ];
    if (isUuid) {
      orConditions.push({ id: trimmedId });
    }

    let employeeId = trimmedId;
    const emp = await this.prisma.employee.findFirst({
      where: {
        OR: orConditions,
      },
    });

    if (emp) {
      employeeId = emp.id;
    }

    // 2. Check for existing OPEN visit (Spec §5 Module 2)
    const openVisit = await this.prisma.visit.findFirst({
      where: {
        employeeId,
        status: VisitStatus.OPEN,
      },
    });

    // Warn (don't hard block) if an open visit already exists
    if (openVisit && !dto.ignoreOpenVisitWarning) {
      this.logger.warn(`⚠️ Open visit warning for Employee ${employeeId}`);
      return {
        status: 'OPEN_VISIT_WARNING',
        openVisit,
        message:
          'Employee already has an open active visit. Confirm if you wish to proceed with a second visit record.',
      };
    }

    // 3. Create Visit
    const visit = await this.prisma.visit.create({
      data: {
        employeeId,
        type: dto.type,
        status: VisitStatus.OPEN,
      },
    });

    this.logger.log(`✅ Created Visit ${visit.id} (${dto.type}) for Employee ${employeeId}`);
    return {
      status: 'CREATED',
      visit,
    };
  }

  async findVisitsByEmployee(employeeId: string) {
    return this.prisma.visit.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(identifier: string) {
    const trimmed = identifier.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

    const orConditions: any[] = [
      { opdVisit: { tokenNumber: { equals: trimmed, mode: 'insensitive' } } },
      { employee: { employeeId: { equals: trimmed, mode: 'insensitive' } } },
      { employee: { hospitalUid: { uidCode: { equals: trimmed, mode: 'insensitive' } } } },
    ];

    if (isUuid) {
      orConditions.push({ id: trimmed });
    }

    const visit = await this.prisma.visit.findFirst({
      where: {
        OR: orConditions,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          include: {
            post: true,
            grade: true,
            employmentType: true,
            patientProfile: true,
            hospitalUid: true,
          },
        },
        opdVisit: { include: { department: true } },
        diagnoses: { orderBy: { createdAt: 'desc' } },
        prescriptions: { include: { items: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!visit) {
      throw new NotFoundException(`No visit record found matching '${trimmed}'`);
    }
    return visit;
  }
}
