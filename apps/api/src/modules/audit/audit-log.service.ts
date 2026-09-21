import { Injectable } from '@nestjs/common';
import { Prisma, AuditStatus, AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toCsv } from '../reports/csv.util';

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  status?: AuditStatus;
  severity?: AuditSeverity;
  dateFrom?: string;
  dateTo?: string;
  /** Free-text search across actor identifier/name, module, description, and IP address. */
  q?: string;
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
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            createdAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { action: { contains: filters.q, mode: 'insensitive' } },
              { entityType: { contains: filters.q, mode: 'insensitive' } },
              { description: { contains: filters.q, mode: 'insensitive' } },
              { ipAddress: { contains: filters.q, mode: 'insensitive' } },
              { actorRole: { contains: filters.q, mode: 'insensitive' } },
              { actorUser: { identifier: { contains: filters.q, mode: 'insensitive' } } },
              { actorUser: { employee: { name: { contains: filters.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    } as Prisma.AuditLogWhereInput;
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
    changedFields: true,
    reason: true,
    description: true,
    status: true,
    severity: true,
    ipAddress: true,
    browser: true,
    os: true,
    device: true,
    impersonatorActorId: true,
    impersonatorRoleLabel: true,
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

  /** Backs the four stat cards on the Activity Log screen (Total / Last 24h / Critical / Failed Logins). */
  async getStats() {
    const last24h = new Date(Date.now() - 24 * 60 * 60_000);
    const [total, recentCount, criticalCount, failedLoginCount] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({ where: { createdAt: { gte: last24h } } }),
      this.prisma.auditLog.count({ where: { severity: 'CRITICAL' } }),
      this.prisma.auditLog.count({ where: { action: 'auth.login_failed' } }),
    ]);

    return { total, last24h: recentCount, critical: criticalCount, failedLogins: failedLoginCount };
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
      ['Timestamp', 'Actor', 'Staff ID', 'Role', 'Impersonated By', 'Action', 'Module', 'Record ID', 'Status', 'Severity', 'IP Address', 'Browser', 'OS', 'Description', 'Reason'],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.actorUser?.identifier ?? r.actorUser?.employee?.name ?? 'System',
        r.actorUser?.employee?.employeeId ?? '',
        r.actorRole,
        r.impersonatorRoleLabel ?? '',
        r.action,
        r.entityType,
        r.entityId,
        r.status,
        r.severity,
        r.ipAddress ?? '',
        r.browser ?? '',
        r.os ?? '',
        r.description ?? '',
        r.reason ?? '',
      ]),
    );
  }
}
