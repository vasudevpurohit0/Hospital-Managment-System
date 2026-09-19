import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import { ChargeService } from '../src/modules/billing/charge.service';
import { ReceiptService } from '../src/modules/billing/receipt.service';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Pharmacy Dispensing & Inventory Enforcement (e2e)', () => {
  let app: INestApplication;
  let pharmacistToken: string;
  let receptionToken: string;

  const rolesStore: any[] = [
    { id: 'r-pharmacist', name: 'Pharmacist', isSystemRole: true },
    { id: 'r-reception', name: 'Reception', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-pharmacist', resource: 'Employee', action: 'read' },
    { id: 'p2', roleId: 'r-pharmacist', resource: 'Prescription', action: 'read' },
    { id: 'p3', roleId: 'r-pharmacist', resource: 'StockTransaction', action: 'dispense' },
    { id: 'p4', roleId: 'r-reception', resource: 'Employee', action: 'read' },
  ];

  const usersStore: any[] = [];
  const batchesStore: any[] = [
    {
      id: 'b-fefo-1',
      medicineId: 'med-1',
      batchNumber: 'EARLY-EXP-101',
      manufacturer: 'Cipla',
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days future (Top FEFO)
      issuePrice: 15.0,
      currentStock: 100,
      minimumStockLevel: 10,
      stockStatus: 'IN_STOCK',
    },
    {
      id: 'b-fefo-2',
      medicineId: 'med-1',
      batchNumber: 'LATER-EXP-202',
      manufacturer: 'Cipla',
      expiryDate: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000), // 300 days future
      issuePrice: 15.0,
      currentStock: 200,
      stockStatus: 'IN_STOCK',
    },
    {
      id: 'b-expired-1',
      medicineId: 'med-1',
      batchNumber: 'EXPIRED-BATCH',
      manufacturer: 'Bad Labs',
      expiryDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Expired 5 days ago
      issuePrice: 10.0,
      currentStock: 50,
      stockStatus: 'EXPIRED',
    },
  ];

  const prescriptionsStore: any[] = [
    {
      id: 'rx-signed-e2e-1',
      visitId: 'v-e2e-1',
      status: 'SIGNED',
      signedAt: new Date(),
      items: [
        {
          id: 'item-e2e-1',
          prescriptionId: 'rx-signed-e2e-1',
          medicineName: 'Paracetamol',
          dose: '500mg',
          frequency: '1-0-1',
          duration: '5 Days',
          dispensedQuantity: 0,
          dispenseStatus: 'PENDING',
          benefitOutcome: 'COVERED',
        },
      ],
      visit: {
        id: 'v-e2e-1',
        patientProfile: {
          fullName: 'Anil Gupta',
          hospitalUid: 'ESIC-26-000555',
          employee: {
            employeeId: 'EMP-555',
            employmentType: { code: 'PERMANENT', name: 'Permanent Employee' },
          },
        },
      },
    },
  ];

  const stockTransactionsStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null;
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = usersStore.find(
          (u) => u.id === where?.id || u.identifier === where?.identifier,
        );
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        const perms = permissionsStore.filter((p) => p.roleId === user.roleId);
        return { ...user, role: { ...role, permissions: perms } };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    prescription: {
      findMany: jest.fn().mockResolvedValue(prescriptionsStore),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return prescriptionsStore.find((rx) => rx.id === where?.id) || null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const rx = prescriptionsStore.find((r) => r.id === where?.id);
        if (rx) Object.assign(rx, data);
        return rx;
      }),
    },
    medicineBatch: {
      findMany: jest.fn().mockImplementation(async () => {
        return batchesStore
          .filter(
            (b) =>
              b.stockStatus !== 'EXPIRED' &&
              b.stockStatus !== 'QUARANTINED' &&
              b.stockStatus !== 'DISPOSED' &&
              b.expiryDate > new Date(),
          )
          .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return batchesStore.find((b) => b.id === where?.id) || null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const b = batchesStore.find((item) => item.id === where?.id);
        if (b) Object.assign(b, data);
        return b;
      }),
      // Atomic conditional decrement (see the `deducted.count === 0` guard
      // this backs in pharmacy.service.ts::dispense()).
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        const b = batchesStore.find((item) => item.id === where?.id);
        const decrementBy = data?.currentStock?.decrement ?? 0;
        if (!b || b.currentStock < decrementBy) return { count: 0 };
        b.currentStock -= decrementBy;
        return { count: 1 };
      }),
    },
    pharmacyStock: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    prescriptionItem: {
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const rx = prescriptionsStore[0];
        const item = rx.items.find((i: any) => i.id === where?.id);
        if (item) Object.assign(item, data);
        return item;
      }),
    },
    stockTransaction: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const txRecord = { id: `st-${Date.now()}`, ...data };
        stockTransactionsStore.push(txRecord);
        return txRecord;
      }),
    },
    benefitRule: {
      findFirst: jest.fn().mockResolvedValue({ outcome: 'COVERED' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    const pharmHash = await bcrypt.hash('PharmPass123!', 10);
    const recHash = await bcrypt.hash('RecPass123!', 10);

    usersStore.push({
      id: '00000000-0000-0000-0000-000000000066',
      identifier: 'pharmacist@esic.gov.in',
      passwordHash: pharmHash,
      roleId: 'r-pharmacist',
      active: true,
    });

    usersStore.push({
      id: '00000000-0000-0000-0000-000000000055',
      identifier: 'reception@esic.gov.in',
      passwordHash: recHash,
      roleId: 'r-reception',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'pharmacist@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'reception@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
      mockPrismaService,
    );

    // ChargeService/ReceiptService are real collaborators pharmacy.service.ts
    // calls directly -- mocked at this boundary rather than re-implementing
    // their own internal Prisma calls (pricing, receipt numbering, etc.),
    // which belong to their own unit tests, not this one.
    const mockChargeService = {
      postPharmacyCharge: jest.fn().mockResolvedValue({ id: 'charge-e2e-1', netAmount: '30.00', status: 'COVERED' }),
    };
    const mockReceiptService = {
      issue: jest.fn().mockResolvedValue({ id: 'receipt-e2e-1', receiptNumber: 'RCPT/2026/000001' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .overrideProvider(ChargeService)
      .useValue(mockChargeService)
      .overrideProvider(ReceiptService)
      .useValue(mockReceiptService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const pharmLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'pharmacist@esic.gov.in', password: 'PharmPass123!' })
      .expect(200);

    pharmacistToken = pharmLogin.body.accessToken;

    const recLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'reception@esic.gov.in', password: 'RecPass123!' })
      .expect(200);

    receptionToken = recLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Pharmacy Queue & FEFO Batch Options (FR-PHM-03 & FR-PHM-07)', () => {
    it('should return signed prescriptions in queue', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/pharmacy/queue')
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].status).toBe('SIGNED');
    });

    it('should return usable batch options ordered by FEFO and EXCLUDE expired batches (FR-PHM-07)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/pharmacy/prescriptions/rx-signed-e2e-1/batches')
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .expect(200);

      const itemBatches = res.body['item-e2e-1'];
      expect(itemBatches).toBeDefined();
      expect(itemBatches[0].batchNumber).toBe('EARLY-EXP-101'); // Earliest expiry batch first (FEFO)

      const expiredPresent = itemBatches.some((b: any) => b.batchNumber === 'EXPIRED-BATCH');
      expect(expiredPresent).toBe(false); // Expired batch strictly excluded!
    });
  });

  describe('2. Role Restriction & Dispense Audit (FR-PHM-08 & Audit)', () => {
    it('should REJECT non-pharmacist user attempting to dispense with 403 Forbidden (FR-PHM-08)', async () => {
      await request(app.getHttpServer())
        .post('/api/pharmacy/dispense')
        .set('Authorization', `Bearer ${receptionToken}`)
        .send({
          prescriptionId: 'rx-signed-e2e-1',
          items: [
            { prescriptionItemId: 'item-e2e-1', medicineBatchId: 'b-fefo-1', dispenseQuantity: 2 },
          ],
        })
        .expect(403);
    });

    it('should allow Pharmacist role to dispense, deduct stock, and create StockTransaction', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/pharmacy/dispense')
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({
          prescriptionId: 'rx-signed-e2e-1',
          items: [
            { prescriptionItemId: 'item-e2e-1', medicineBatchId: 'b-fefo-1', dispenseQuantity: 2 },
          ],
        })
        .expect(201);

      expect(res.body.status).toBe('CLOSED');
      expect(stockTransactionsStore.length).toBeGreaterThan(0);
      expect(stockTransactionsStore[0].quantity).toBe(-2);
    });
  });
});
