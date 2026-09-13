import { PrismaClient, ServiceApplicability, ServiceType, ServiceUnit } from '@prisma/client';
import { SEED_CATEGORIES, SEED_PRICE_REASON, buildSeedServices } from './catalog-data';

/**
 * Seeds the service catalogue and its opening rates.
 *
 * Idempotent, and specifically safe to re-run against a live database:
 *
 *  - Categories and services are upserted by their stable code.
 *  - A seed price is written ONLY when the service has no price version at all.
 *    Once an administrator has priced or repriced a service, re-running the
 *    seed must never reset that rate — otherwise a deployment would silently
 *    revert hospital pricing decisions and change what patients are charged.
 */
export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  const categoryIdByCode = new Map<string, string>();

  for (const category of SEED_CATEGORIES) {
    const row = await prisma.serviceCategory.upsert({
      where: { code: category.code },
      update: { name: category.name, sortOrder: category.sortOrder },
      create: {
        code: category.code,
        name: category.name,
        sortOrder: category.sortOrder,
      },
    });
    categoryIdByCode.set(category.code, row.id);
  }
  console.log(`  ✓ Seeded ${SEED_CATEGORIES.length} service categories`);

  const services = buildSeedServices();
  const serviceIdByCode = new Map<string, string>();

  let pricedCount = 0;
  let unpricedCount = 0;
  let preservedCount = 0;

  for (const service of services) {
    const categoryId = categoryIdByCode.get(service.categoryCode);
    if (!categoryId) {
      throw new Error(`Unknown category code "${service.categoryCode}" for ${service.code}`);
    }

    const row = await prisma.service.upsert({
      where: { code: service.code },
      // Descriptive fields are refreshed from the reference data; pricing is
      // never touched here.
      update: {
        name: service.name,
        categoryId,
        serviceType: service.serviceType as ServiceType,
        applicability: (service.applicability ?? 'BOTH') as ServiceApplicability,
        unit: (service.unit ?? 'SITTING') as ServiceUnit,
        description: service.description ?? null,
        courseDurationDays: service.courseDurationDays ?? null,
        sourceReference: service.sourceReference,
      },
      create: {
        code: service.code,
        name: service.name,
        categoryId,
        serviceType: service.serviceType as ServiceType,
        applicability: (service.applicability ?? 'BOTH') as ServiceApplicability,
        unit: (service.unit ?? 'SITTING') as ServiceUnit,
        description: service.description ?? null,
        courseDurationDays: service.courseDurationDays ?? null,
        sourceReference: service.sourceReference,
        active: true,
      },
    });

    serviceIdByCode.set(service.code, row.id);

    if (service.amount === null) {
      unpricedCount++;
      continue;
    }

    const existingPriceCount = await prisma.servicePrice.count({
      where: { serviceId: row.id },
    });

    if (existingPriceCount > 0) {
      // Already priced — an administrator may have changed it since. Leave it.
      preservedCount++;
      continue;
    }

    await prisma.servicePrice.create({
      data: {
        serviceId: row.id,
        amount: service.amount,
        // Opening version starts at epoch-of-record so any historical charge
        // backfilled later still resolves a rate.
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        reason: SEED_PRICE_REASON,
        createdById: null,
      },
    });
    pricedCount++;
  }

  console.log(
    `  ✓ Seeded ${services.length} services ` +
      `(${pricedCount} newly priced, ${preservedCount} existing prices preserved, ` +
      `${unpricedCount} intentionally unpriced)`,
  );

  // Package components, replaced wholesale so the list matches the source.
  let packageLinks = 0;
  for (const service of services) {
    if (!service.components?.length) continue;

    const packageId = serviceIdByCode.get(service.code);
    if (!packageId) continue;

    await prisma.servicePackageItem.deleteMany({ where: { packageServiceId: packageId } });

    for (const componentCode of service.components) {
      const componentId = serviceIdByCode.get(componentCode);
      if (!componentId) {
        throw new Error(`Package ${service.code} references unknown component ${componentCode}`);
      }
      await prisma.servicePackageItem.create({
        data: { packageServiceId: packageId, componentServiceId: componentId, quantity: 1 },
      });
      packageLinks++;
    }
  }
  console.log(`  ✓ Seeded ${packageLinks} package component links`);

  if (unpricedCount > 0) {
    console.log(
      `  ⓘ ${unpricedCount} services are deliberately unpriced (no rate in the reference ` +
        `material). They are orderable as package components but will refuse standalone ` +
        `billing until an administrator sets a price. See GET /api/catalog/services/unpriced.`,
    );
  }
}
