import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toCsv } from '../reports/csv.util';

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
    return {
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' } } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    };
  }

  private readonly rowSelect = {
    id: true,
    createdAt: true,
    actorUserId: true,
    actorRole: true,
    action: true,
    entityType: true,
    entityId: true,
    beforeSnapshot: true,
    afterSnapshot: true,
    reason: true,
    actorUser: {
      select: {
        identifier: true,
        employee: { select: { name: true, employeeId: true } },
      },
    },
  } as const;

  async findAll(filters: AuditLogFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
    const where = this.buildWhere(filters);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: this.rowSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Same filters, no pagination cap beyond a hard ceiling -- an export is a deliberate one-off pull, not a paged UI. */
  async exportCsv(filters: Omit<AuditLogFilters, 'page' | 'limit'>): Promise<string> {
    const where = this.buildWhere(filters);
    const rows = await this.prisma.auditLog.findMany({
      where,
      select: this.rowSelect,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    return toCsv(
      ['Timestamp', 'Actor', 'Staff ID', 'Role', 'Action', 'Module', 'Record ID', 'Reason'],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.actorUser?.identifier ?? r.actorUser?.employee?.name ?? 'System',
        r.actorUser?.employee?.employeeId ?? '',
        r.actorRole,
        r.action,
        r.entityType,
        r.entityId,
        r.reason ?? '',
      ]),
    );
  }
}
