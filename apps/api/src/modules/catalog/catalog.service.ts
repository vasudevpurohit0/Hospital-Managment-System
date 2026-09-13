import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ServiceApplicability, ServiceType, ServiceUnit } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateServiceDto, UpdateServiceDto, ServiceQueryDto } from './dto/service.dto';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listCategories() {
    const categories = await this.prisma.serviceCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { services: true } } },
    });

    return categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      sortOrder: c.sortOrder,
      active: c.active,
      serviceCount: c._count.services,
    }));
  }

  /**
   * Lists services with their currently effective price.
   *
   * The price is read from the open version rather than joined blindly, so a
   * service with no rate shows as unpriced instead of silently showing zero.
   */
  async listServices(query: ServiceQueryDto) {
    const { search, categoryId, serviceType, applicability, active, unpricedOnly } = query;
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Math.min(Number(query.limit) > 0 ? Number(query.limit) : 50, 200);

    const where: Prisma.ServiceWhereInput = {};

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (serviceType) where.serviceType = serviceType as ServiceType;
    if (applicability) where.applicability = applicability as ServiceApplicability;
    if (active !== undefined) where.active = String(active) === 'true';
    if (String(unpricedOnly) === 'true') where.prices = { none: {} };

    const now = new Date();

    const [total, services] = await Promise.all([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({
        where,
        include: {
          category: true,
          prices: {
            where: {
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
          _count: { select: { packageItems: true } },
        },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      items: services.map((s) => this.toListItem(s)),
    };
  }

  async getService(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        category: true,
        prices: { orderBy: { effectiveFrom: 'desc' } },
        packageItems: { include: { componentService: { include: { category: true } } } },
      },
    });

    if (!service) throw new NotFoundException(`Service not found: ${id}`);

    const now = new Date();
    const current = service.prices.find(
      (p) => p.effectiveFrom <= now && (p.effectiveTo === null || p.effectiveTo > now),
    );

    return {
      id: service.id,
      code: service.code,
      name: service.name,
      category: { id: service.category.id, code: service.category.code, name: service.category.name },
      serviceType: service.serviceType,
      applicability: service.applicability,
      unit: service.unit,
      description: service.description,
      durationMinutes: service.durationMinutes,
      courseDurationDays: service.courseDurationDays,
      sourceReference: service.sourceReference,
      active: service.active,
      currentPrice: current ? current.amount.toString() : null,
      currentPriceEffectiveFrom: current?.effectiveFrom ?? null,
      priceVersionCount: service.prices.length,
      components: service.packageItems.map((item) => ({
        serviceId: item.componentService.id,
        code: item.componentService.code,
        name: item.componentService.name,
        category: item.componentService.category.name,
        quantity: item.quantity,
      })),
    };
  }

  async createService(dto: CreateServiceDto, actorUserId?: string) {
    const code = dto.code.trim().toUpperCase();

    const [existing, category] = await Promise.all([
      this.prisma.service.findUnique({ where: { code } }),
      this.prisma.serviceCategory.findUnique({ where: { id: dto.categoryId } }),
    ]);

    if (existing) {
      throw new ConflictException(`Service code ${code} is already in use by "${existing.name}".`);
    }
    if (!category) {
      throw new NotFoundException(`Service category not found: ${dto.categoryId}`);
    }

    const service = await this.prisma.service.create({
      data: {
        code,
        name: dto.name.trim(),
        categoryId: dto.categoryId,
        serviceType: dto.serviceType as ServiceType,
        applicability: (dto.applicability ?? 'BOTH') as ServiceApplicability,
        unit: (dto.unit ?? 'SITTING') as ServiceUnit,
        description: dto.description?.trim() || null,
        durationMinutes: dto.durationMinutes ?? null,
        courseDurationDays: dto.courseDurationDays ?? null,
        sourceReference: dto.sourceReference?.trim() || null,
        active: dto.active ?? true,
        createdById: actorUserId ?? null,
        updatedById: actorUserId ?? null,
      },
      include: { category: true },
    });

    this.logger.log(`Created service ${service.code} — ${service.name}`);
    return this.getService(service.id);
  }

  async updateService(id: string, dto: UpdateServiceDto, actorUserId?: string) {
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Service not found: ${id}`);

    if (dto.categoryId) {
      const category = await this.prisma.serviceCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new NotFoundException(`Service category not found: ${dto.categoryId}`);
    }

    await this.prisma.service.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        categoryId: dto.categoryId ?? undefined,
        serviceType: (dto.serviceType as ServiceType) ?? undefined,
        applicability: (dto.applicability as ServiceApplicability) ?? undefined,
        unit: (dto.unit as ServiceUnit) ?? undefined,
        description: dto.description !== undefined ? dto.description?.trim() || null : undefined,
        durationMinutes: dto.durationMinutes ?? undefined,
        courseDurationDays: dto.courseDurationDays ?? undefined,
        sourceReference:
          dto.sourceReference !== undefined ? dto.sourceReference?.trim() || null : undefined,
        active: dto.active ?? undefined,
        updatedById: actorUserId ?? null,
      },
    });

    return this.getService(id);
  }

  /**
   * Replaces a package's component list.
   *
   * Only a PACKAGE may have components, and a package cannot contain itself or
   * another package — nesting would make it ambiguous which rate applies.
   */
  async setPackageComponents(
    packageServiceId: string,
    components: { serviceId: string; quantity?: number }[],
  ) {
    const pkg = await this.prisma.service.findUnique({ where: { id: packageServiceId } });
    if (!pkg) throw new NotFoundException(`Service not found: ${packageServiceId}`);
    if (pkg.serviceType !== ServiceType.PACKAGE) {
      throw new BadRequestException(
        `"${pkg.name}" is a ${pkg.serviceType}, not a PACKAGE, so it cannot have components.`,
      );
    }

    const ids = components.map((c) => c.serviceId);
    if (ids.includes(packageServiceId)) {
      throw new BadRequestException('A package cannot contain itself.');
    }

    const found = await this.prisma.service.findMany({ where: { id: { in: ids } } });
    if (found.length !== new Set(ids).size) {
      throw new BadRequestException('One or more component services do not exist.');
    }
    const nested = found.filter((s) => s.serviceType === ServiceType.PACKAGE);
    if (nested.length) {
      throw new BadRequestException(
        `A package cannot contain another package: ${nested.map((s) => s.name).join(', ')}.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.servicePackageItem.deleteMany({ where: { packageServiceId } });
      if (components.length) {
        await tx.servicePackageItem.createMany({
          data: components.map((c) => ({
            packageServiceId,
            componentServiceId: c.serviceId,
            quantity: c.quantity ?? 1,
          })),
        });
      }
    });

    return this.getService(packageServiceId);
  }

  private toListItem(s: {
    id: string;
    code: string;
    name: string;
    serviceType: ServiceType;
    applicability: ServiceApplicability;
    unit: ServiceUnit;
    active: boolean;
    sourceReference: string | null;
    category: { id: string; name: string; code: string };
    prices: { id: string; amount: Prisma.Decimal; effectiveFrom: Date }[];
    _count: { packageItems: number };
  }) {
    const current = s.prices[0];
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      category: s.category.name,
      categoryId: s.category.id,
      serviceType: s.serviceType,
      applicability: s.applicability,
      unit: s.unit,
      active: s.active,
      sourceReference: s.sourceReference,
      componentCount: s._count.packageItems,
      currentPrice: current ? current.amount.toString() : null,
      currentPriceEffectiveFrom: current?.effectiveFrom ?? null,
      isPriced: Boolean(current),
    };
  }
}
