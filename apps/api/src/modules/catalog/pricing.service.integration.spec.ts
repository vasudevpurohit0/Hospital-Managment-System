import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from './pricing.service';

/**
 * Integration tests against the real database.
 *
 * The guarantees under test — one open price version per service enforced by a
 * partial unique index, and a rate resolved as-of a date — live in Postgres.
 * Mocking the client would assert only that the code calls itself.
 */
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('PricingService (integration)', () => {
  let prisma: PrismaService;
  let service: PricingService;
  let categoryId: string;

  const createdServiceIds: string[] = [];

  const iso = (d: string) => new Date(`${d}T00:00:00.000Z`);

  /** Creates a throwaway service for one test. */
  async function makeService(code: string) {
    const row = await prisma.service.create({
      data: {
        code: `ZZTEST-${code}-${Date.now().toString().slice(-6)}`,
        name: `Test ${code}`,
        categoryId,
        serviceType: 'THERAPY',
        applicability: 'BOTH',
        unit: 'SITTING',
      },
    });
    createdServiceIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PricingService(prisma);

    const category = await prisma.serviceCategory.upsert({
      where: { code: 'ZZTESTCAT' },
      update: {},
      create: { code: 'ZZTESTCAT', name: 'Test Category', sortOrder: 999 },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.servicePrice.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    // audit_logs is append-only (a real Postgres trigger rejects DELETE,
    // deliberately, so no one -- including test cleanup -- can quietly erase
    // audit history) -- the 'service_price.change'/'ZZTest' rows this suite
    // writes are left in place rather than attempting a delete that always
    // fails and would abort the rest of this cleanup along with it.
    await prisma.serviceCategory.deleteMany({ where: { code: 'ZZTESTCAT' } });
    await prisma.$disconnect();
  });

  describe('the Feature 2 guarantee: old bills never change', () => {
    // The worked example from the requirements, as a test:
    //   Therapy A is ₹500 from 20 Aug. On 29 Aug an administrator sets ₹700.
    //   A bill raised on 22 Aug must still resolve ₹500.
    it('resolves the rate that applied on the date of the charge, not the latest rate', async () => {
      const svc = await makeService('HISTORIC');

      await service.setPrice({
        serviceId: svc.id,
        amount: 500,
        effectiveFrom: iso('2026-08-20'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await service.setPrice({
        serviceId: svc.id,
        amount: 700,
        effectiveFrom: iso('2026-08-29'),
        reason: 'Revised rate',
        actorRole: 'ZZTest',
      });

      const onOldBill = await service.resolve(svc.id, iso('2026-08-22'));
      const onNewBill = await service.resolve(svc.id, iso('2026-08-30'));

      expect(onOldBill.amount.toString()).toBe('500');
      expect(onNewBill.amount.toString()).toBe('700');
      // The two bills point at different price versions, so each is traceable
      // to the rate that produced it.
      expect(onOldBill.servicePriceId).not.toBe(onNewBill.servicePriceId);
    });

    it('resolves the boundary day to the new rate', async () => {
      const svc = await makeService('BOUNDARY');
      await service.setPrice({
        serviceId: svc.id,
        amount: 500,
        effectiveFrom: iso('2026-08-20'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await service.setPrice({
        serviceId: svc.id,
        amount: 700,
        effectiveFrom: iso('2026-08-29'),
        reason: 'Revised rate',
        actorRole: 'ZZTest',
      });

      expect((await service.resolve(svc.id, iso('2026-08-29'))).amount.toString()).toBe('700');
      // One millisecond earlier is still the old rate.
      expect(
        (await service.resolve(svc.id, new Date(iso('2026-08-29').getTime() - 1))).amount.toString(),
      ).toBe('500');
    });

    it('never updates a price row in place — it supersedes', async () => {
      const svc = await makeService('SUPERSEDE');
      const first = await service.setPrice({
        serviceId: svc.id,
        amount: 500,
        effectiveFrom: iso('2026-08-20'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await service.setPrice({
        serviceId: svc.id,
        amount: 700,
        effectiveFrom: iso('2026-08-29'),
        reason: 'Revised rate',
        actorRole: 'ZZTest',
      });

      const versions = await prisma.servicePrice.findMany({
        where: { serviceId: svc.id },
        orderBy: { effectiveFrom: 'asc' },
      });

      expect(versions).toHaveLength(2);
      // The original row still exists, with its original amount, now closed.
      expect(versions[0].id).toBe(first.current.servicePriceId);
      expect(versions[0].amount.toString()).toBe('500');
      expect(versions[0].effectiveTo).toEqual(iso('2026-08-29'));
      expect(versions[1].effectiveTo).toBeNull();
    });
  });

  describe('integrity', () => {
    it('allows at most one open version per service', async () => {
      const svc = await makeService('ONEOPEN');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-01-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });

      // Bypassing the service to prove the database itself refuses a second
      // open version, whatever application code does.
      await expect(
        prisma.servicePrice.create({
          data: {
            serviceId: svc.id,
            amount: new Prisma.Decimal(200),
            effectiveFrom: iso('2026-02-01'),
            effectiveTo: null,
            reason: 'Illegal second open version',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects back-dating before the current version', async () => {
      const svc = await makeService('BACKDATE');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-08-20'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });

      await expect(
        service.setPrice({
          serviceId: svc.id,
          amount: 150,
          effectiveFrom: iso('2026-08-01'),
          reason: 'Attempted back-date',
          actorRole: 'ZZTest',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a future-dated rate revision', async () => {
      const svc = await makeService('FUTURE');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-08-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await service.setPrice({
        serviceId: svc.id,
        amount: 120,
        effectiveFrom: iso('2027-04-01'),
        reason: 'Announced revision',
        actorRole: 'ZZTest',
      });

      // Today still resolves the current rate; the new one waits its turn.
      expect((await service.resolve(svc.id, iso('2026-09-01'))).amount.toString()).toBe('100');
      expect((await service.resolve(svc.id, iso('2027-05-01'))).amount.toString()).toBe('120');
    });

    it('rejects a no-op repricing to the same amount', async () => {
      const svc = await makeService('NOOP');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-08-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });

      await expect(
        service.setPrice({
          serviceId: svc.id,
          amount: 100,
          effectiveFrom: iso('2026-09-01'),
          reason: 'Same again',
          actorRole: 'ZZTest',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a negative rate', async () => {
      const svc = await makeService('NEGATIVE');
      await expect(
        service.setPrice({
          serviceId: svc.id,
          amount: -5,
          effectiveFrom: iso('2026-08-01'),
          reason: 'Nonsense',
          actorRole: 'ZZTest',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires a reason for every change, so history explains itself', async () => {
      const svc = await makeService('NOREASON');
      await expect(
        service.setPrice({
          serviceId: svc.id,
          amount: 100,
          effectiveFrom: iso('2026-08-01'),
          reason: '   ',
          actorRole: 'ZZTest',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('services with no published rate', () => {
    it('refuses to resolve a price for an unpriced service', async () => {
      const svc = await makeService('UNPRICED');

      await expect(service.resolve(svc.id)).rejects.toThrow(BadRequestException);
      await expect(service.resolve(svc.id)).rejects.toThrow(/No effective price/);
    });

    it('refuses to resolve before the first version takes effect', async () => {
      const svc = await makeService('NOTYET');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-08-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });

      await expect(service.resolve(svc.id, iso('2026-07-01'))).rejects.toThrow(BadRequestException);
    });

    it('refuses to resolve a price for an inactive service', async () => {
      const svc = await makeService('INACTIVE');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-08-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await prisma.service.update({ where: { id: svc.id }, data: { active: false } });

      await expect(service.resolve(svc.id)).rejects.toThrow(/inactive/);
    });
  });

  describe('audit trail', () => {
    it('records service, old amount, new amount, effective date, actor and reason', async () => {
      const svc = await makeService('AUDIT');
      await service.setPrice({
        serviceId: svc.id,
        amount: 500,
        effectiveFrom: iso('2026-08-20'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      const second = await service.setPrice({
        serviceId: svc.id,
        amount: 700,
        effectiveFrom: iso('2026-08-29'),
        reason: 'Annual revision per circular 12/2026',
        actorRole: 'ZZTest',
      });

      const log = await prisma.auditLog.findFirst({
        where: { entityType: 'ServicePrice', entityId: second.current.servicePriceId },
      });

      expect(log).not.toBeNull();
      expect(log!.action).toBe('service_price.change');
      expect(log!.actorRole).toBe('ZZTest');
      expect(log!.beforeSnapshot).toMatchObject({ amount: '500' });
      expect(log!.afterSnapshot).toMatchObject({
        amount: '700',
        reason: 'Annual revision per circular 12/2026',
      });
    });

    it('exposes the full version history newest first', async () => {
      const svc = await makeService('HISTORY');
      await service.setPrice({
        serviceId: svc.id,
        amount: 100,
        effectiveFrom: iso('2026-01-01'),
        reason: 'Opening rate',
        actorRole: 'ZZTest',
      });
      await service.setPrice({
        serviceId: svc.id,
        amount: 200,
        effectiveFrom: iso('2026-06-01'),
        reason: 'Mid-year revision',
        actorRole: 'ZZTest',
      });

      const history = await service.history(svc.id);

      expect(history.versions).toHaveLength(2);
      expect(history.versions[0].amount).toBe('200');
      expect(history.versions[0].isCurrent).toBe(true);
      expect(history.versions[1].amount).toBe('100');
      expect(history.versions[1].isCurrent).toBe(false);
      expect(history.versions[1].reason).toBe('Opening rate');
    });
  });

  describe('seeded reference catalogue', () => {
    it('prices the therapies the CGHS annexures publish', async () => {
      const expectations: [string, string][] = [
        ['AYU-001', '1145'], // Annexure A-2 S.No 1, Abhyanga
        ['AYU-059', '1995'], // A-2 S.No 59, Pizhichil/Kayaseka
        ['YOG-011', '25'], // Annexure Y-2 S.No 11, Kapalabhati
        ['CARE-PREPOST', '75'], // A-2 note (c), per day
      ];

      for (const [code, amount] of expectations) {
        const svc = await prisma.service.findUnique({ where: { code } });
        expect(svc).not.toBeNull();
        expect((await service.resolve(svc!.id)).amount.toString()).toBe(amount);
      }
    });

    // Annexure Y-2 lists a week of yoga therapy twice at different rates,
    // once for OPD and once as an indoor admission. Modelling the setting as a
    // property of the row keeps both; a single row with two rate columns could
    // not have represented it.
    it('keeps the OPD and IPD yoga packages as distinct services', async () => {
      const opd = await prisma.service.findUnique({ where: { code: 'YOG-020' } });
      const ipd = await prisma.service.findUnique({ where: { code: 'YOG-025' } });

      expect(opd!.applicability).toBe('OPD');
      expect(ipd!.applicability).toBe('IPD');
      expect((await service.resolve(opd!.id)).amount.toString()).toBe('500');
      expect((await service.resolve(ipd!.id)).amount.toString()).toBe('10000');
    });

    it('gives the workflow-critical services a provisional rate so the ledger chain is live', async () => {
      // No source publishes an ESIC consultation, a bed-day, or a standalone
      // Nadi/Prakrati/HIV rate. Leaving them unpriced left a patient's ledger
      // empty after a full OPD + IPD episode, so they carry a provisional
      // starting amount tagged "Provisional default rate" for administrative
      // review — not a sourced figure, but enough to keep billing flowing.
      const provisional: [string, string][] = [
        ['CONSULT-GEN', '20'],
        ['CONSULT-SPEC', '50'],
        ['CONSULT-FOLLOWUP', '10'],
        ['BED-GENERAL', '500'],
        ['LAB-HIV', '80'],
        ['LAB-NADI', '100'],
        ['LAB-PRAKRATI', '100'],
      ];

      for (const [code, amount] of provisional) {
        const svc = await prisma.service.findUnique({ where: { code } });
        expect(svc).not.toBeNull();
        expect(svc!.sourceReference).toBe('Provisional default rate');
        expect((await service.resolve(svc!.id)).amount.toString()).toBe(amount);
      }

      const unpricedCodes = (await service.unpricedServices()).map((s) => s.code);
      expect(unpricedCodes).not.toContain('CONSULT-GEN');
      expect(unpricedCodes).not.toContain('BED-GENERAL');
    });

    it('records the source of every seeded rate so it can be reviewed', async () => {
      const sampled = await prisma.service.findMany({
        where: { code: { in: ['AYU-001', 'YOG-025', 'LAB-CBC', 'LAB-ECG'] } },
      });

      expect(sampled).toHaveLength(4);
      for (const svc of sampled) {
        expect(svc.sourceReference).toBeTruthy();
      }
      expect(sampled.find((s) => s.code === 'AYU-001')!.sourceReference).toContain('Annexure A-2');
      // ECG is priced from a receipt, not the rate board, and says so.
      expect(sampled.find((s) => s.code === 'LAB-ECG')!.sourceReference).toContain('Receipt');
    });
  });
});
