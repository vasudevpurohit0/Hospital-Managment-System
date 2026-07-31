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

    // 1. Resolve employee
    let employeeId = trimmedId;
    const emp = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { id: trimmedId },
          { employeeId: trimmedId },
          { hospitalUid: { uidCode: trimmedId } },
        ],
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

  async findOne(id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
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
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }
    return visit;
  }
}
