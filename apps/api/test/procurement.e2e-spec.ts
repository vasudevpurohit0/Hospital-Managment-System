import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Procurement Module (E2E - Phase 12 Supply Chain)', () => {
  let app: INestApplication;
  let authToken: string;
  let approverToken: string;
  let createdRequisitionId: string;
  let createdPOId: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'SuperAdmin', isSystemRole: true },
    { id: 'r-approver', name: 'ProcurementApprover', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'PurchaseRequisition', action: 'create' },
    { id: 'p2', roleId: 'r-admin', resource: 'PurchaseRequisition', action: 'read' },
    { id: 'p3', roleId: 'r-admin', resource: 'PurchaseOrder', action: 'create' },
    { id: 'p4', roleId: 'r-admin', resource: 'PurchaseOrder', action: 'read' },
    { id: 'p5', roleId: 'r-admin', resource: 'MedicineBatch', action: 'create' },
    { id: 'p6', roleId: 'r-admin', resource: 'MedicineBatch', action: 'update' },
    // approveRequisition() blocks self-approval (F-03): the requisition's
    // raiser and its approver must be two different users, so this suite
    // logs in a second user just to call the approve endpoint.
    { id: 'p7', roleId: 'r-approver', resource: 'Approval', action: 'approve' },
  ];
  const usersStore: any[] = [];

  const requisitionsStore: any[] = [];
  const approvalsStore: any[] = [];
  const purchaseOrdersStore: any[] = [];
  const grnStore: any[] = [];
  const medicineBatchesStore: any[] = [
    {
      id: 'batch-p-500-01',
      medicineId: 'med-paracetamol',
      currentStock: 40,
      minimumStockLevel: 0,
      reorderLevel: 10,
      stockStatus: 'IN_STOCK',
    },
  ];
  const pharmacyStockStore: any[] = [
    { id: 'ps-central-1', medicineBatchId: 'batch-p-500-01', location: 'CENTRAL_STORE', quantity: 200 },
  ];
  const storeTransfersStore: any[] = [];

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(++seq).toString().padStart(4, '0')}`;

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = usersStore.find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        const perms = permissionsStore.filter((p) => p.roleId === user.roleId);
        return { ...user, role: { ...role, permissions: perms } };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    purchaseRequisition: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const req = {
          id: nextId('req'),
          raisedBy: data.raisedBy,
          triggeredByAlert: data.triggeredByAlert,
          status: data.status,
          items: data.items.create.map((i: any) => ({ ...i, id: nextId('reqitem'), medicine: { id: i.medicineId } })),
          approvals: [],
        };
        requisitionsStore.push(req);
        return req;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const req = requisitionsStore.find((r) => r.id === where?.id);
        return req ? { ...req, approvals: approvalsStore.filter((a) => a.requisitionId === req.id) } : null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const req = requisitionsStore.find((r) => r.id === where?.id);
        if (req) Object.assign(req, data);
        return req;
      }),
    },
    approval: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const approval = { id: nextId('appr'), ...data };
        approvalsStore.push(approval);
        return approval;
      }),
    },
    purchaseOrder: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const po = {
          id: nextId('po'),
          requisitionId: data.requisitionId,
          supplierId: data.supplierId,
          status: data.status,
          items: data.items.create.map((i: any) => ({ ...i, id: nextId('poitem'), medicine: { id: i.medicineId } })),
          goodsReceiptNotes: [],
          supplier: { id: data.supplierId, name: 'Test Supplier' },
        };
        purchaseOrdersStore.push(po);
        return po;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const po = purchaseOrdersStore.find((p) => p.id === where?.id);
        return po ? { ...po, goodsReceiptNotes: grnStore.filter((g) => g.purchaseOrderId === po.id) } : null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const po = purchaseOrdersStore.find((p) => p.id === where?.id);
        if (po) Object.assign(po, data);
        return po;
      }),
    },
    goodsReceiptNote: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const grn = {
          id: nextId('grn'),
          purchaseOrderId: data.purchaseOrderId,
          verifiedBy: data.verifiedBy,
          items: data.items.create.map((i: any) => ({ ...i, id: nextId('grnitem') })),
        };
        grnStore.push(grn);
        return grn;
      }),
    },
    medicineBatch: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => medicineBatchesStore.find((b) => b.id === where?.id) || null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const batch = { id: nextId('batch'), currentStock: data.currentStock, ...data };
        medicineBatchesStore.push(batch);
        return batch;
      }),
    },
    pharmacyStock: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        return pharmacyStockStore.find((s) => s.medicineBatchId === where?.medicineBatchId && s.location === where?.location) || null;
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        const s = pharmacyStockStore.find((row) => row.id === where?.id);
        const decrementBy = data?.quantity?.decrement ?? 0;
        if (!s || s.quantity < decrementBy) return { count: 0 };
        s.quantity -= decrementBy;
        return { count: 1 };
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const s = pharmacyStockStore.find((row) => row.id === where?.id);
        if (s && data?.quantity?.increment !== undefined) s.quantity += data.quantity.increment;
        return s;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const s = { id: nextId('ps'), ...data };
        pharmacyStockStore.push(s);
        return s;
      }),
    },
    storeTransfer: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const t = { id: nextId('transfer'), ...data };
        storeTransfersStore.push(t);
        return t;
      }),
    },
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('SuperAdminSecret123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000010',
      identifier: 'superadmin@esic.gov.in',
      passwordHash,
      roleId: 'r-admin',
      active: true,
    });
    const approverHash = await bcrypt.hash('ApproverPass123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000011',
      identifier: 'approver@esic.gov.in',
      passwordHash: approverHash,
      roleId: 'r-approver',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'superadmin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'approver@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
      mockPrismaService,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer()).post('/api/auth/login').send({
      identifier: 'superadmin@esic.gov.in',
      password: 'SuperAdminSecret123!',
    });
    authToken = loginRes.body.accessToken || '';

    const approverLogin = await request(app.getHttpServer()).post('/api/auth/login').send({
      identifier: 'approver@esic.gov.in',
      password: 'ApproverPass123!',
    });
    approverToken = approverLogin.body.accessToken || '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. POST /api/procurement/requisitions - Should create a Purchase Requisition', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/procurement/requisitions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ medicineId: 'med-paracetamol', quantity: 500 }],
        triggeredByAlert: false,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('PENDING');
    createdRequisitionId = res.body.id;
  });

  it('2. POST /api/procurement/purchase-orders - Should REJECT unapproved requisition (FR-SCM-03)', async () => {
    // Create another unapproved requisition
    const reqRes = await request(app.getHttpServer())
      .post('/api/procurement/requisitions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ medicineId: 'med-paracetamol', quantity: 200 }],
      });

    const unapprovedReqId = reqRes.body.id;

    await request(app.getHttpServer())
      .post('/api/procurement/purchase-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        requisitionId: unapprovedReqId,
        supplierId: 'sup-01',
        items: [{ medicineId: 'med-paracetamol', quantity: 200, unitPrice: 10 }],
      })
      .expect(400); // Bad Request (FR-SCM-03 approval check)
  });

  it('3. POST /api/procurement/requisitions/:id/approve - Should approve requisition', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/procurement/requisitions/${createdRequisitionId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        decision: 'APPROVED',
        notes: 'Verified stock deficit',
      })
      .expect(201);

    expect(res.body.decision).toBe('APPROVED');
  });

  it('4. POST /api/procurement/purchase-orders - Should issue PO for APPROVED requisition', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/procurement/purchase-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        requisitionId: createdRequisitionId,
        supplierId: 'sup-01',
        items: [{ medicineId: 'med-paracetamol', quantity: 500, unitPrice: 10 }],
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('ISSUED');
    createdPOId = res.body.id;
  });

  it('5. POST /api/procurement/goods-receipt-notes - Should record GRN delivery & add Central Store stock', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/procurement/goods-receipt-notes')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        purchaseOrderId: createdPOId,
        items: [
          {
            medicineId: 'med-paracetamol',
            batchNumber: 'GRN-E2E-2026-B1',
            manufacturer: 'Cipla',
            quantity: 500,
            manufacturingDate: '2026-01-01',
            expiryDate: '2028-06-30',
            purchasePrice: 10,
            issuePrice: 15,
            qualityCheckPass: true,
          },
        ],
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  it('6. POST /api/procurement/transfers - Should execute StoreTransfer from Central Store to Pharmacy', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/procurement/transfers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        medicineBatchId: 'batch-p-500-01',
        fromLocation: 'CENTRAL_STORE',
        toLocation: 'PHARMACY',
        quantity: 100,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });
});
