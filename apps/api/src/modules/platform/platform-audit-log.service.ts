import { Injectable } from '@nestjs/common';
import { Prisma } from '.prisma/platform-client';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { toCsv } from '../reports/csv.util';

export interface PlatformAuditLogFilters {
  /** Free-text search across admin email, hospital name, action, resource, method and path. */
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Every time a Super Admin accessed a specific hospital's data (via
 * X-Hospital-Id) -- a platform-schema-only log, structurally distinct from
 * PlatformStaffAuditService (which reads each hospital's own tenant
 * AuditLog table for STAFF actions). This one has no severity/status
 * concept at all: every row here is just "this admin touched this hospital
 * this way," so the stat tiles and filters below only surface what the data
 * actually supports, rather than mirroring the tenant Activity Log's
 * severity/failed-login tiles onto a model that has neither.
 */
@Injectable()
export class PlatformAuditLogService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  private buildWhere(filters: PlatformAuditLogFilters): Prisma.PlatformAuditLogWhereInput {
    return {
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
              { resource: { contains: filters.q, mode: 'insensitive' } },
              { method: { contains: filters.q, mode: 'insensitive' } },
              { path: { contains: filters.q, mode: 'insensitive' } },
              { platformUser: { email: { contains: filters.q, mode: 'insensitive' } } },
              { platformUser: { name: { contains: filters.q, mode: 'insensitive' } } },
              { hospital: { name: { contains: filters.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    } as Prisma.PlatformAuditLogWhereInput;
  }

  private readonly rowInclude = {
    platformUser: { select: { email: true, name: true } },
    hospital: { select: { name: true, slug: true } },
  } as const;

  async findAll(filters: PlatformAuditLogFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
    const where = this.buildWhere(filters);

    const [rows, total] = await Promise.all([
      this.platformPrisma.platformAuditLog.findMany({
        where,
        include: this.rowInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.platformPrisma.platformAuditLog.count({ where }),
    ]);

    return {
      items: rows.map((e) => ({
        id: e.id,
        action: e.action,
        resource: e.resource,
        method: e.method,
        path: e.path,
        metadata: e.metadata,
        createdAt: e.createdAt,
        platformUserEmail: e.platformUser.email,
        platformUserName: e.platformUser.name,
        hospitalName: e.hospital?.name ?? null,
        hospitalSlug: e.hospital?.slug ?? null,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Backs the stat tiles on the Platform Audit Log screen -- only what this model actually supports (no severity/status here, unlike the tenant Activity Log). */
  async getStats() {
    const last24h = new Date(Date.now() - 24 * 60 * 60_000);
    const [total, recentCount, uniqueAdmins, hospitalsTouched] = await Promise.all([
      this.platformPrisma.platformAuditLog.count(),
      this.platformPrisma.platformAuditLog.count({ where: { createdAt: { gte: last24h } } }),
      this.platformPrisma.platformAuditLog.findMany({ distinct: ['platformUserId'], select: { platformUserId: true } }),
      this.platformPrisma.platformAuditLog.findMany({
        where: { hospitalId: { not: null } },
        distinct: ['hospitalId'],
        select: { hospitalId: true },
      }),
    ]);

    return {
      total,
      last24h: recentCount,
      uniqueAdmins: uniqueAdmins.length,
      hospitalsTouched: hospitalsTouched.length,
    };
  }

  async exportCsv(filters: Omit<PlatformAuditLogFilters, 'page' | 'limit'>): Promise<string> {
    const where = this.buildWhere(filters);
    const rows = await this.platformPrisma.platformAuditLog.findMany({
      where,
      include: this.rowInclude,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    return toCsv(
      ['Timestamp', 'Admin', 'Hospital', 'Action', 'Resource', 'Method', 'Path'],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.platformUser.email,
        r.hospital?.name ?? '',
        r.action,
        r.resource ?? '',
        r.method ?? '',
        r.path ?? '',
      ]),
    );
  }
}
