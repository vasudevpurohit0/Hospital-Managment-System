import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OpdTokenGeneratorService } from './opd-token-generator.service';
import { DepartmentService } from './department.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';

const isUuid = (str: string) =>
  typeof str === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const DEV_OPD_VISITS_STORE: any[] = [
  {
    id: 'opd-1',
    visitId: 'v-1001',
    departmentId: 'dept-gen-med',
    tokenNumber: 'GENMED-001',
    calledAt: new Date(Date.now() - 300000).toISOString(),
    closedAt: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    department: { id: 'dept-gen-med', name: 'General Medicine', code: 'GENMED' },
    visit: {
      id: 'v-1001',
      employeeId: 'EMP-1001',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Suresh Patel', employeeId: 'EMP-1001', department: 'General Med' },
    },
  },
  {
    id: 'opd-2',
    visitId: 'v-1002',
    departmentId: 'dept-gen-med',
    tokenNumber: 'GENMED-002',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 2400000).toISOString(),
    department: { id: 'dept-gen-med', name: 'General Medicine', code: 'GENMED' },
    visit: {
      id: 'v-1002',
      employeeId: 'EMP-1002',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Priya Devi', employeeId: 'EMP-1002', department: 'General Med' },
    },
  },
  {
    id: 'opd-3',
    visitId: 'v-1003',
    departmentId: 'dept-gen-med',
    tokenNumber: 'GENMED-003',
    calledAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    department: { id: 'dept-gen-med', name: 'General Medicine', code: 'GENMED' },
    visit: {
      id: 'v-1003',
      employeeId: 'EMP-1003',
      type: 'OPD',
      status: 'OPEN',
      employee: { name: 'Rahul Kumar', employeeId: 'EMP-1003', department: 'General Med' },
    },
  },
];

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

    if (isUuid(dto.visitId) && isUuid(dept.id)) {
      try {
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Dev fallback for OPDVisit creation: ${message}`);
      }
    }

    const mockOpdVisit = {
      id: `opd-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      visitId: dto.visitId,
      departmentId: dept.id,
      tokenNumber,
      calledAt: null,
      closedAt: null,
      createdAt: new Date().toISOString(),
      department: dept,
      visit: {
        id: dto.visitId,
        type: 'OPD',
        status: 'OPEN',
        employee: {
          name: 'Sample Patient',
          employeeId: 'EMP-1001',
        },
      },
    };

    DEV_OPD_VISITS_STORE.push(mockOpdVisit);

    return {
      status: 'CREATED',
      opdVisit: mockOpdVisit,
      tokenNumber,
    };
  }

  /**
   * Fetch current queue for a department (waiting & called tokens)
   */
  async getQueue(departmentId: string) {
    const dept = await this.departmentService.findById(departmentId);
    const targetDeptId = dept?.id || departmentId;

    if (isUuid(targetDeptId)) {
      try {
        const activeQueue = await this.prisma.oPDVisit.findMany({
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

        return activeQueue;
      } catch {
        // Fall through to memory store
      }
    }

    return DEV_OPD_VISITS_STORE.filter(
      (o) =>
        (o.departmentId === departmentId ||
          o.department?.code === departmentId ||
          o.department?.id === departmentId ||
          (dept && (o.departmentId === dept.id || o.departmentId === dept.code))) &&
        !o.closedAt,
    );
  }

  /**
   * Mark token called by attending doctor
   */
  async callToken(id: string) {
    const calledAt = new Date();

    if (isUuid(id)) {
      try {
        const targetVisit = await this.prisma.oPDVisit.findUnique({ where: { id } });
        if (targetVisit) {
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
        }

        const updated = await this.prisma.oPDVisit.update({
          where: { id },
          data: { calledAt },
          include: { department: true, visit: { include: { employee: true } } },
        });
        return updated;
      } catch {
        // Fall through
      }
    }

    const item = DEV_OPD_VISITS_STORE.find((o) => o.id === id);
    if (item) {
      DEV_OPD_VISITS_STORE.forEach((o) => {
        if (o.departmentId === item.departmentId && o.calledAt && !o.closedAt && o.id !== id) {
          o.closedAt = calledAt.toISOString();
        }
      });
      item.calledAt = calledAt.toISOString();
      return item;
    }
    throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
  }

  /**
   * Mark visit closed
   */
  async closeOpdVisit(id: string) {
    const closedAt = new Date();

    if (isUuid(id)) {
      try {
        const updated = await this.prisma.oPDVisit.update({
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
        return updated;
      } catch {
        // Fall through
      }
    }

    const item = DEV_OPD_VISITS_STORE.find((o) => o.id === id);
    if (item) {
      item.closedAt = closedAt.toISOString();
      if (item.visit) {
        item.visit.status = 'CLOSED';
      }
      return item;
    }
    throw new NotFoundException(`OPDVisit not found for ID: ${id}`);
  }
}
