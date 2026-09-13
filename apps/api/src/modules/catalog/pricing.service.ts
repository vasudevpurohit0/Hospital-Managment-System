import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

/** A rate resolved for a point in time, with the exact version it came from. */
export interface ResolvedPrice {
  serviceId: string;
  serviceName: string;
  categoryName: string;
  /** The price version the amount came from. Stored on every charge so a bill
   *  can be traced to the rate that produced it. */
  servicePriceId: string;
  amount: Prisma.Decimal;
  effectiveFrom: Date;
}

/**
 * The only way any module obtains a rate.
 *
 * Centralising resolution is what makes Feature 2's guarantee enforceable:
 * a charge records both the amount and the price version, so changing a price
 * later cannot alter a bill that was already raised.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the rate effective for a service at a moment in time.
   *
   * Throws when the service has no price covering that moment, which is how
   * services seeded without a published rate (consultation, bed-day, Nadi
   * Pariksha) stay orderable as package components but refuse standalone
   * billing until an administrator prices them.
   */
  async resolve(
    serviceId: string,
    at: Date = new Date(),
    tx?: PrismaClientLike,
  ): Promise<ResolvedPrice> {
    const client = tx ?? this.prisma;

    const service = await client.service.findUnique({
      where: { id: serviceId },
      include: { category: true },
    });

    if (!service) {
      throw new NotFoundException(`Service not found: ${serviceId}`);
    }
    if (!service.active) {
      throw new BadRequestException(
        `Service "${service.name}" is inactive and cannot be charged.`,
      );
    }

    const price = await client.servicePrice.findFirst({
      where: {
        serviceId,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!price) {
      throw new BadRequestException(
        `No effective price for "${service.name}" on ${at.toISOString().slice(0, 10)}. ` +
          `Set a price in Service Pricing before billing this service.`,
      );
    }

    return {
      serviceId: service.id,
      serviceName: service.name,
      categoryName: service.category.name,
      servicePriceId: price.id,
      amount: price.amount,
      effectiveFrom: price.effectiveFrom,
    };
  }

  /** Resolves several services at once, reporting all failures together. */
  async resolveMany(
    serviceIds: string[],
    at: Date = new Date(),
    tx?: PrismaClientLike,
  ): Promise<Map<string, ResolvedPrice>> {
    const resolved = new Map<string, ResolvedPrice>();
    const failures: string[] = [];

    for (const id of new Set(serviceIds)) {
      try {
        resolved.set(id, await this.resolve(id, at, tx));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (failures.length) {
      throw new BadRequestException(failures.join(' '));
    }
    return resolved;
  }

  /**
   * Supersedes the open price version with a new one.
   *
   * Never updates a rate in place: the open version is closed at the new
   * effective date and a fresh row is inserted, so historical bills keep
   * resolving the rate that applied when they were raised. The whole change,
   * including its audit record, is one transaction.
   */
  async setPrice(params: {
    serviceId: string;
    amount: number | Prisma.Decimal;
    effectiveFrom: Date;
    reason: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ previous: { amount: string; effectiveFrom: Date } | null; current: ResolvedPrice }> {
    const { serviceId, effectiveFrom, reason, actorUserId, actorRole } = params;
    const amount = new Prisma.Decimal(params.amount);

    if (amount.isNegative()) {
      throw new BadRequestException('Price cannot be negative.');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required for every price change.');
    }

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      include: { category: true },
    });
    if (!service) {
      throw new NotFoundException(`Service not found: ${serviceId}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.servicePrice.findFirst({
        where: { serviceId, effectiveTo: null },
      });

      if (open) {
        // Back-dating before the open version would silently rewrite which rate
        // applied on days that have already been billed.
        if (effectiveFrom < open.effectiveFrom) {
          throw new BadRequestException(
            `Effective date ${effectiveFrom.toISOString().slice(0, 10)} is before the current ` +
              `price started (${open.effectiveFrom.toISOString().slice(0, 10)}). ` +
              `Back-dating a rate would change bills that were already issued.`,
          );
        }
        if (open.amount.equals(amount)) {
          throw new ConflictException(
            `"${service.name}" is already priced at ₹${amount.toFixed(2)}.`,
          );
        }

        await tx.servicePrice.update({
          where: { id: open.id },
          data: { effectiveTo: effectiveFrom },
        });
      }

      const created = await tx.servicePrice.create({
        data: {
          serviceId,
          amount,
          effectiveFrom,
          reason: reason.trim(),
          createdById: actorUserId ?? null,
        },
      });

      // Written explicitly rather than left to the generic AuditInterceptor,
      // which derives its entity type from the URL and records the request body
      // as the "before" snapshot — neither of which yields a usable price history.
      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId ?? null,
          actorRole: actorRole ?? 'Unknown',
          action: 'service_price.change',
          entityType: 'ServicePrice',
          entityId: created.id,
          beforeSnapshot: open
            ? {
                serviceCode: service.code,
                serviceName: service.name,
                amount: open.amount.toString(),
                effectiveFrom: open.effectiveFrom.toISOString(),
              }
            : Prisma.JsonNull,
          afterSnapshot: {
            serviceCode: service.code,
            serviceName: service.name,
            amount: amount.toString(),
            effectiveFrom: effectiveFrom.toISOString(),
            reason: reason.trim(),
          },
        },
      });

      this.logger.log(
        `Repriced ${service.code} (${service.name}): ` +
          `${open ? `₹${open.amount.toFixed(2)}` : 'unpriced'} → ₹${amount.toFixed(2)} ` +
          `from ${effectiveFrom.toISOString().slice(0, 10)}`,
      );

      return {
        previous: open
          ? { amount: open.amount.toString(), effectiveFrom: open.effectiveFrom }
          : null,
        current: {
          serviceId: service.id,
          serviceName: service.name,
          categoryName: service.category.name,
          servicePriceId: created.id,
          amount: created.amount,
          effectiveFrom: created.effectiveFrom,
        },
      };
    });
  }

  /** Full price history for a service, newest first. */
  async history(serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      throw new NotFoundException(`Service not found: ${serviceId}`);
    }

    const [versions, auditRows] = await Promise.all([
      this.prisma.servicePrice.findMany({
        where: { serviceId },
        orderBy: { effectiveFrom: 'desc' },
        include: { createdBy: { select: { id: true, identifier: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'ServicePrice', action: 'service_price.change' },
        orderBy: { createdAt: 'desc' },
        include: { actorUser: { select: { identifier: true } } },
      }),
    ]);

    const auditByPriceId = new Map(auditRows.map((row) => [row.entityId, row]));

    return {
      serviceId: service.id,
      serviceCode: service.code,
      serviceName: service.name,
      versions: versions.map((v) => ({
        id: v.id,
        amount: v.amount.toString(),
        effectiveFrom: v.effectiveFrom,
        effectiveTo: v.effectiveTo,
        isCurrent: v.effectiveTo === null,
        reason: v.reason,
        changedBy: v.createdBy?.identifier ?? auditByPriceId.get(v.id)?.actorUser?.identifier ?? null,
        changedAt: v.createdAt,
      })),
    };
  }

  /** Services that are active but have no price version at all. */
  async unpricedServices() {
    const rows = await this.prisma.service.findMany({
      where: { active: true, prices: { none: {} } },
      include: { category: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      category: s.category.name,
      serviceType: s.serviceType,
      sourceReference: s.sourceReference,
    }));
  }
}
