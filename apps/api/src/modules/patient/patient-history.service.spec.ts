import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PatientHistoryService } from './patient-history.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeService } from '../billing/charge.service';
import { DocumentRenderService } from '../../common/rendering/document-render.service';

describe('PatientHistoryService', () => {
  let service: PatientHistoryService;

  const mockPrisma = {
    employee: { findUnique: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    stockTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const mockChargeService = { patientLedger: jest.fn() };
  const mockDocumentRender = { getBranding: jest.fn().mockResolvedValue({ hospitalName: 'ESIC Test Hospital', tagline: '', primaryColor: '#005691' }) };

  /** A minimal but structurally complete employee record -- every relation the query includes must be present (possibly empty), matching what Prisma would actually return. */
  function baseEmployee(overrides: Record<string, any> = {}) {
    return {
      id: 'emp-1',
      employeeId: 'EMP-1001',
      name: 'Test Patient',
      contactPhone: '9999999999',
      registrationDate: new Date('2026-01-01T05:00:00Z'),
      createdAt: new Date('2026-01-01T05:00:00Z'),
      patientProfile: { dob: new Date('1990-01-01'), gender: 'MALE', address: '123 St' },
      hospitalUid: { uidCode: 'HSP001' },
      employmentType: { name: 'Permanent' },
      visits: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientHistoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChargeService, useValue: mockChargeService },
        { provide: DocumentRenderService, useValue: mockDocumentRender },
      ],
    }).compile();

    service = module.get<PatientHistoryService>(PatientHistoryService);
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.stockTransaction.findMany.mockResolvedValue([]);
    mockDocumentRender.getBranding.mockResolvedValue({ hospitalName: 'ESIC Test Hospital', tagline: '', primaryColor: '#005691' });
  });

  it('throws NotFoundException when the patient does not exist', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(null);
    await expect(service.getPatientTimeline('missing', { canViewBilling: false })).rejects.toThrow(NotFoundException);
  });

  it('always includes exactly one REGISTRATION event for a patient with no visits', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(baseEmployee());

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });

    expect(report.events).toHaveLength(1);
    expect(report.events[0].type).toBe('REGISTRATION');
    expect(report.events[0].timeRecorded).toBe(true);
    expect(report.summary.totalVisits).toBe(0);
  });

  it('builds VISIT and QUEUE events for a single OPD visit', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(
      baseEmployee({
        visits: [
          {
            id: 'v-1',
            type: 'OPD',
            status: 'OPEN',
            createdAt: new Date('2026-02-01T04:00:00Z'),
            opdVisit: {
              id: 'ov-1',
              tokenNumber: 'CARDIO-001',
              opdNumber: 'OPD/2026/001',
              status: 'COMPLETED',
              department: { name: 'Cardiology' },
              assignedAt: new Date('2026-02-01T04:00:00Z'),
              checkedInAt: new Date('2026-02-01T04:05:00Z'),
              calledAt: new Date('2026-02-01T04:10:00Z'),
              consultationStartedAt: new Date('2026-02-01T04:11:00Z'),
              completedAt: new Date('2026-02-01T04:30:00Z'),
              closedAt: new Date('2026-02-01T04:31:00Z'),
              doctorId: null,
            },
            diagnoses: [],
            prescriptions: [],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [],
          },
        ],
      }),
    );

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });

    const types = report.events.map((e) => e.type);
    expect(types).toEqual(['REGISTRATION', 'VISIT', 'QUEUE']);
    const queueEvent = report.events.find((e) => e.type === 'QUEUE')!;
    expect(queueEvent.details.tokenNumber).toBe('CARDIO-001');
    expect(queueEvent.department).toBe('Cardiology');
  });

  it('reports a mixed Inventory + Custom prescription and does not invent an administration time', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(
      baseEmployee({
        visits: [
          {
            id: 'v-1',
            type: 'OPD',
            status: 'OPEN',
            createdAt: new Date('2026-02-01T04:00:00Z'),
            opdVisit: null,
            diagnoses: [],
            prescriptions: [
              {
                id: 'rx-1',
                doctorId: null,
                status: 'SIGNED',
                signedAt: new Date('2026-02-01T04:20:00Z'),
                createdAt: new Date('2026-02-01T04:15:00Z'),
                items: [
                  {
                    id: 'item-inv',
                    medicineName: 'Paracetamol 650mg',
                    medicineType: 'INVENTORY',
                    dose: '1 Tablet',
                    frequency: '1-0-1',
                    duration: '5 Days',
                    dispenseStatus: 'DISPENSED',
                    dispensedQuantity: 10,
                  },
                  {
                    id: 'item-custom',
                    medicineName: 'Amoxicillin 500mg',
                    medicineType: 'CUSTOM',
                    dose: '1 Capsule',
                    frequency: '1-0-1',
                    duration: '5 Days',
                    dispenseStatus: 'DISPENSED',
                    dispensedQuantity: 10,
                  },
                ],
              },
            ],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [],
          },
        ],
      }),
    );
    // Only the INVENTORY item produced a real StockTransaction -- CUSTOM
    // items never do (PharmacyService skips stock movement for them).
    mockPrisma.stockTransaction.findMany.mockResolvedValue([
      { prescriptionItemId: 'item-inv', createdAt: new Date('2026-02-01T05:00:00Z'), performedBy: 'user-pharmacist' },
    ]);

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });

    const prescriptionEvent = report.events.find((e) => e.type === 'PRESCRIPTION')!;
    expect((prescriptionEvent.details as any).items).toHaveLength(2);
    expect((prescriptionEvent.details as any).items[1].medicineType).toBe('CUSTOM');

    // A real dispense timestamp exists for the INVENTORY item, so a
    // MEDICINE_DISPENSED event is anchored on it.
    const dispensedEvent = report.events.find((e) => e.type === 'MEDICINE_DISPENSED')!;
    expect(dispensedEvent.timestamp).toBe(new Date('2026-02-01T05:00:00Z').toISOString());

    // medicationHistory: 3 rows per item (PRESCRIBED/DISPENSED/ADMINISTERED) x 2 items = 6.
    expect(report.medicationHistory).toHaveLength(6);

    const customDispensedRow = report.medicationHistory.find((r) => r.prescriptionItemId === 'item-custom' && r.stage === 'DISPENSED')!;
    expect(customDispensedRow.timeRecorded).toBe(false);
    expect(customDispensedRow.timestamp).toBeNull();
    expect(customDispensedRow.notRecordedReason).toBeTruthy();

    const invDispensedRow = report.medicationHistory.find((r) => r.prescriptionItemId === 'item-inv' && r.stage === 'DISPENSED')!;
    expect(invDispensedRow.timeRecorded).toBe(true);
    expect(invDispensedRow.timestamp).toBe(new Date('2026-02-01T05:00:00Z').toISOString());

    // Every ADMINISTERED row is always "not recorded" -- this system has no MAR module.
    const administeredRows = report.medicationHistory.filter((r) => r.stage === 'ADMINISTERED');
    expect(administeredRows).toHaveLength(2);
    for (const row of administeredRows) {
      expect(row.timestamp).toBeNull();
      expect(row.timeRecorded).toBe(false);
      expect(row.notRecordedReason).toMatch(/does not record medication administration/i);
    }
  });

  it('does not emit a MEDICINE_DISPENSED timeline event when no item has a real dispense timestamp (all custom)', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(
      baseEmployee({
        visits: [
          {
            id: 'v-1',
            type: 'OPD',
            status: 'OPEN',
            createdAt: new Date('2026-02-01T04:00:00Z'),
            opdVisit: null,
            diagnoses: [],
            prescriptions: [
              {
                id: 'rx-1',
                doctorId: null,
                status: 'SIGNED',
                signedAt: new Date('2026-02-01T04:20:00Z'),
                createdAt: new Date('2026-02-01T04:15:00Z'),
                items: [
                  {
                    id: 'item-custom',
                    medicineName: 'Amoxicillin 500mg',
                    medicineType: 'CUSTOM',
                    dose: '1 Capsule',
                    frequency: '1-0-1',
                    duration: '5 Days',
                    dispenseStatus: 'DISPENSED',
                    dispensedQuantity: 10,
                  },
                ],
              },
            ],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [],
          },
        ],
      }),
    );
    mockPrisma.stockTransaction.findMany.mockResolvedValue([]);

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });

    expect(report.events.some((e) => e.type === 'MEDICINE_DISPENSED')).toBe(false);
    // But medicationHistory still records the dispensed stage, honestly as "not recorded".
    const dispensedRow = report.medicationHistory.find((r) => r.stage === 'DISPENSED')!;
    expect(dispensedRow.timeRecorded).toBe(false);
  });

  it('builds ADMISSION, BED_MOVEMENT, PROGRESS_NOTE and DISCHARGE events for a completed IPD stay', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(
      baseEmployee({
        visits: [
          {
            id: 'v-1',
            type: 'IPD',
            status: 'OPEN',
            createdAt: new Date('2026-03-01T00:00:00Z'),
            opdVisit: null,
            diagnoses: [],
            prescriptions: [],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [
              {
                id: 'adm-1',
                admissionNumber: 'IPD/2026/001',
                status: 'DISCHARGED',
                requestedAt: new Date('2026-03-01T00:00:00Z'),
                allocatedAt: new Date('2026-03-01T00:10:00Z'),
                dischargedAt: new Date('2026-03-04T10:00:00Z'),
                assignedDoctorId: null,
                assignedNurseId: null,
                ward: { name: 'General Ward' },
                room: { roomNumber: '204' },
                bed: { bedNumber: '12' },
                notes: [
                  { id: 'note-1', createdAt: new Date('2026-03-02T08:00:00Z'), authoredBy: null, note: 'Stable overnight.' },
                ],
                locationHistory: [
                  {
                    id: 'move-1',
                    movedAt: new Date('2026-03-02T12:00:00Z'),
                    movedById: null,
                    reason: 'ICU transfer',
                    fromWardId: 'w-1',
                    fromWard: { name: 'General Ward' },
                    fromRoom: { roomNumber: '204' },
                    fromBed: { bedNumber: '12' },
                    toWard: { name: 'ICU' },
                    toRoom: { roomNumber: 'ICU-1' },
                    toBed: { bedNumber: 'ICU-03' },
                  },
                ],
                dischargeSummary: { approvedBy: null, summaryText: 'Recovered well.' },
              },
            ],
          },
        ],
      }),
    );

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });
    const types = report.events.map((e) => e.type);

    expect(types).toEqual(['REGISTRATION', 'VISIT', 'ADMISSION', 'PROGRESS_NOTE', 'BED_MOVEMENT', 'DISCHARGE']);
    const discharge = report.events.find((e) => e.type === 'DISCHARGE')!;
    // allocatedAt 03-01 00:10 -> dischargedAt 03-04 10:00 = 3 days 9h50m, rounded up.
    expect((discharge.details as any).lengthOfStayDays).toBe(4);
  });

  it('gates billing: canViewBilling=false zeroes billing figures and emits no PAYMENT events, even though a ledger exists', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(baseEmployee());

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });

    expect(mockChargeService.patientLedger).not.toHaveBeenCalled();
    expect(report.billing).toEqual({ authorized: false, total: 0, paid: 0, pending: 0 });
    expect(report.events.some((e) => e.type === 'PAYMENT')).toBe(false);
  });

  it('gates billing: canViewBilling=true surfaces real ledger figures and PAYMENT events', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(baseEmployee());
    mockChargeService.patientLedger.mockResolvedValue({
      summary: { totalAmount: '500.00', paidAmount: '500.00', outstandingAmount: '0.00' },
      transactions: [
        { receiptNumber: 'RCPT/1', totalAmount: '500.00', category: 'Pharmacy', date: new Date('2026-02-01T06:00:00Z') },
      ],
    });

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: true });

    expect(report.billing).toEqual({ authorized: true, total: 500, paid: 500, pending: 0 });
    const payment = report.events.find((e) => e.type === 'PAYMENT')!;
    expect(payment).toBeDefined();
    expect((payment.details as any).amount).toBe(500);
  });

  it('sorts events chronologically ascending across multiple days', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(
      baseEmployee({
        visits: [
          {
            id: 'v-2',
            type: 'OPD',
            status: 'CLOSED',
            createdAt: new Date('2026-05-10T00:00:00Z'),
            opdVisit: null,
            diagnoses: [],
            prescriptions: [],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [],
          },
          {
            id: 'v-1',
            type: 'OPD',
            status: 'CLOSED',
            createdAt: new Date('2026-02-01T00:00:00Z'),
            opdVisit: null,
            diagnoses: [],
            prescriptions: [],
            labOrders: [],
            therapyCourses: [],
            therapySessions: [],
            admissions: [],
          },
        ],
      }),
    );

    const report = await service.getPatientTimeline('emp-1', { canViewBilling: false });
    const timestamps = report.events.map((e) => e.timestamp);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);
  });
});
