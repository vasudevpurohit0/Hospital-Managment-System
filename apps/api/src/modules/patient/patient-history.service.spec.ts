import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PatientHistoryService } from './patient-history.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeService } from '../billing/charge.service';
import { DocumentRenderService } from '../../common/rendering/document-render.service';
import { renderPatientHistoryHtml } from '../../common/rendering/pdf-templates';

/**
 * Feature: Complete Patient Clinical Timeline, Treatment History &
 * Downloadable PDF.
 *
 * Every test below asserts against real record shapes (no invented events):
 * - chronological ordering from actual timestamps
 * - prescribed / dispensed / administered kept distinct
 * - CUSTOM items never get a recorded dispense time (no StockTransaction)
 * - billing gated on Charge:read
 * - unknown (incl. cross-hospital) ids yield NotFound with no data
 * - progress notes surfaced as their own events
 */
describe('PatientHistoryService', () => {
  let service: PatientHistoryService;

  const mockPrisma: any = {
    employee: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    stockTransaction: { findMany: jest.fn() },
  };
  const mockCharge: any = { patientLedger: jest.fn() };
  const mockRender: any = {
    getBranding: jest.fn().mockResolvedValue({ hospitalName: 'ESIC Hospital', tagline: '', primaryColor: '#005691' }),
  };

  const doctorUser = { id: 'user-doc-1', identifier: 'doc@esic.in', employee: { name: 'Dr. Rao' }, role: { name: 'Doctor' } };
  const nurseUser = { id: 'user-nurse-1', identifier: 'nurse@esic.in', employee: { name: 'Nurse Asha' }, role: { name: 'Nurse' } };

  const baseEmployee: any = {
    id: 'emp-uuid-1',
    employeeId: 'EMP-1001',
    name: 'Rajesh Kumar',
    contactPhone: '+91 9876543210',
    registrationDate: new Date('2026-01-05T09:00:00Z'),
    createdAt: new Date('2026-01-05T09:00:00Z'),
    hospitalUid: { uidCode: 'HSP00000001' },
    employmentType: { name: 'Permanent' },
    patientProfile: { dob: new Date('1990-06-15'), gender: 'MALE', address: '123 Main St' },
    visits: [
      {
        id: 'visit-1',
        type: 'OPD',
        status: 'CLOSED',
        createdAt: new Date('2026-02-01T09:30:00Z'),
        opdVisit: {
          id: 'opd-1',
          tokenNumber: 'CARDIO-001',
          opdNumber: 'OPD/2026/000001',
          status: 'COMPLETED',
          assignedAt: new Date('2026-02-01T09:00:00Z'),
          checkedInAt: new Date('2026-02-01T09:15:00Z'),
          calledAt: new Date('2026-02-01T09:20:00Z'),
          consultationStartedAt: new Date('2026-02-01T09:25:00Z'),
          completedAt: new Date('2026-02-01T10:00:00Z'),
          closedAt: new Date('2026-02-01T10:05:00Z'),
          doctorId: 'user-doc-1',
          department: { name: 'Cardiology' },
        },
        diagnoses: [
          {
            id: 'diag-1',
            doctorId: 'user-doc-1',
            symptoms: 'Chest pain',
            examinationNotes: 'BP 140/90, ECG normal',
            diagnosisText: 'Stable angina',
            followUpFlag: true,
            admissionRecommended: false,
            createdAt: new Date('2026-02-01T09:45:00Z'),
          },
        ],
        prescriptions: [
          {
            id: 'rx-1',
            doctorId: 'user-doc-1',
            status: 'SIGNED',
            signedAt: new Date('2026-02-01T09:50:00Z'),
            createdAt: new Date('2026-02-01T09:40:00Z'),
            items: [
              {
                id: 'item-inv-1',
                medicineName: 'Aspirin 75mg',
                medicineType: 'INVENTORY',
                dose: '75mg',
                frequency: 'OD',
                duration: '30 days',
                dispensedQuantity: 30,
                dispenseStatus: 'DISPENSED',
              },
              {
                id: 'item-custom-1',
                medicineName: 'Himalaya Arjuna capsules',
                medicineType: 'CUSTOM',
                dose: '1 cap',
                frequency: 'BD',
                duration: '15 days',
                dispensedQuantity: 30,
                dispenseStatus: 'DISPENSED',
              },
            ],
          },
        ],
        labOrders: [
          {
            id: 'lo-1',
            labNumber: 'LAB/2026/000087',
            priority: 'ROUTINE',
            status: 'REPORTED',
            createdAt: new Date('2026-02-01T10:10:00Z'),
            admissionId: null,
            orderedBy: 'user-doc-1',
            items: [
              {
                labTest: { name: 'Lipid Profile', code: 'LIPID' },
                status: 'VERIFIED',
                results: [
                  {
                    value: '210',
                    flag: 'HIGH',
                    parameter: { name: 'Total Cholesterol', groupLabel: null, unit: 'mg/dL', ranges: [{ displayText: '125-200' }] },
                  },
                ],
              },
            ],
            sample: {
              sampleCode: 'S26-0000731',
              specimenType: 'Serum',
              collectedAt: new Date('2026-02-01T10:30:00Z'),
              collectedById: 'user-nurse-1',
            },
            report: {
              id: 'rep-1',
              releasedAt: new Date('2026-02-02T14:00:00Z'),
              verifiedById: 'user-doc-1',
              pathologistRemarks: 'Borderline high',
            },
          },
        ],
        therapyCourses: [],
        therapySessions: [
          {
            id: 'ts-1',
            service: { name: 'Abhyanga', serviceType: 'THERAPY' },
            status: 'PERFORMED',
            sessionNumber: 1,
            notes: 'Tolerated well',
            source: 'OPD',
            scheduledAt: new Date('2026-02-03T10:00:00Z'),
            performedAt: new Date('2026-02-03T10:30:00Z'),
            performedById: 'user-nurse-1',
            createdById: 'user-doc-1',
            admissionId: null,
          },
        ],
        admissions: [
          {
            id: 'adm-1',
            admissionNumber: 'IPD/2026/000045',
            status: 'DISCHARGED',
            requestedAt: new Date('2026-02-05T08:00:00Z'),
            allocatedAt: new Date('2026-02-05T10:00:00Z'),
            dischargedAt: new Date('2026-02-08T11:00:00Z'),
            ward: { name: 'General Ward' },
            room: { roomNumber: '204' },
            bed: { bedNumber: '12' },
            assignedDoctorId: 'user-doc-1',
            assignedNurseId: 'user-nurse-1',
            notes: [
              { id: 'note-1', note: 'Patient stable, vitals normal', authoredBy: 'user-nurse-1', createdAt: new Date('2026-02-06T09:00:00Z') },
              { id: 'note-2', note: 'Discharge planned tomorrow', authoredBy: 'user-doc-1', createdAt: new Date('2026-02-07T18:00:00Z') },
            ],
            locationHistory: [
              {
                id: 'move-1',
                movedAt: new Date('2026-02-06T12:00:00Z'),
                movedById: 'user-nurse-1',
                reason: 'Step-down care',
                fromWardId: 'w1',
                fromWard: { name: 'ICU' },
                fromRoom: { roomNumber: '1' },
                fromBed: { bedNumber: '2' },
                toWard: { name: 'General Ward' },
                toRoom: { roomNumber: '204' },
                toBed: { bedNumber: '12' },
              },
            ],
            dischargeSummary: { approvedBy: 'user-doc-1', summaryText: 'Recovered, follow up in 2 weeks' },
          },
        ],
      },
    ],
  };

  const ledgerFixture = {
    summary: { totalAmount: '1500', paidAmount: '1000', outstandingAmount: '500' },
    transactions: [
      { receiptNumber: 'R/2026/0001', totalAmount: '1000', date: new Date('2026-02-02T10:00:00Z') },
      { receiptNumber: null, totalAmount: '500', date: new Date('2026-02-03T10:00:00Z') },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientHistoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChargeService, useValue: mockCharge },
        { provide: DocumentRenderService, useValue: mockRender },
      ],
    }).compile();
    service = module.get<PatientHistoryService>(PatientHistoryService);
    jest.clearAllMocks();
    mockRender.getBranding.mockResolvedValue({ hospitalName: 'ESIC Hospital', tagline: '', primaryColor: '#005691' });
    mockPrisma.user.findMany.mockResolvedValue([doctorUser, nurseUser]);
    // Only the INVENTORY item has a real dispense transaction; the CUSTOM
    // item never produces one (PharmacyService skips stock movement for it).
    mockPrisma.stockTransaction.findMany.mockResolvedValue([
      { prescriptionItemId: 'item-inv-1', type: 'DISPENSE', createdAt: new Date('2026-02-01T12:00:00Z'), performedBy: 'user-nurse-1' },
    ]);
    mockCharge.patientLedger.mockResolvedValue(ledgerFixture);
    mockPrisma.employee.findUnique.mockResolvedValue(structuredClone(baseEmployee));
  });

  it('throws NotFound for an unknown id and leaks no data (tenant isolation: cross-hospital ids resolve to null in this schema)', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(null);
    await expect(service.getPatientTimeline('no-such-id', { canViewBilling: true })).rejects.toThrow(NotFoundException);
    expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'no-such-id' } }));
    expect(mockCharge.patientLedger).not.toHaveBeenCalled();
  });

  it('builds a complete chronological timeline from real records only', async () => {
    const report = await service.getPatientTimeline('emp-uuid-1', { canViewBilling: true });
    const types = report.events.map((e) => e.type);
    for (const expected of [
      'REGISTRATION',
      'VISIT',
      'QUEUE',
      'CONSULTATION',
      'PRESCRIPTION',
      'MEDICINE_DISPENSED',
      'LAB_ORDER',
      'LAB_RESULT',
      'THERAPY_SESSION',
      'ADMISSION',
      'BED_MOVEMENT',
      'PROGRESS_NOTE',
      'DISCHARGE',
      'PAYMENT',
    ]) {
      expect(types).toContain(expected);
    }
    // Chronological: every event timestamp is non-decreasing.
    const times = report.events.map((e) => new Date(e.timestamp as string).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    // Registration anchors on the real registrationDate.
    expect(report.events[0].type).toBe('REGISTRATION');
    // Two progress-note events, one per AdmissionNote row.
    expect(report.events.filter((e) => e.type === 'PROGRESS_NOTE')).toHaveLength(2);
    expect(report.events.find((e) => e.type === 'PROGRESS_NOTE')?.details).toMatchObject({
      admissionNumber: 'IPD/2026/000045',
    });
  });

  it('keeps prescribed / dispensed / administered as distinct rows and never invents an administered time', async () => {
    const report = await service.getPatientTimeline('emp-uuid-1', { canViewBilling: true });
    const inv = report.medicationHistory.filter((r) => r.prescriptionItemId === 'item-inv-1');
    expect(inv.map((r) => r.stage).sort()).toEqual(['ADMINISTERED', 'DISPENSED', 'PRESCRIBED']);
    const dispensed = inv.find((r) => r.stage === 'DISPENSED')!;
    expect(dispensed.timeRecorded).toBe(true);
    expect(dispensed.timestamp).toBe(new Date('2026-02-01T12:00:00Z').toISOString());
    const administered = inv.find((r) => r.stage === 'ADMINISTERED')!;
    expect(administered.timestamp).toBeNull();
    expect(administered.timeRecorded).toBe(false);
    expect(administered.notRecordedReason).toMatch(/no MAR/i);
  });

  it('marks a CUSTOM dispensed item as time-not-recorded (no StockTransaction is ever written for it)', async () => {
    const report = await service.getPatientTimeline('emp-uuid-1', { canViewBilling: true });
    const custom = report.medicationHistory.filter((r) => r.prescriptionItemId === 'item-custom-1');
    expect(custom.find((r) => r.stage === 'PRESCRIBED')?.medicineType).toBe('CUSTOM');
    const dispensed = custom.find((r) => r.stage === 'DISPENSED')!;
    expect(dispensed.timeRecorded).toBe(false);
    expect(dispensed.timestamp).toBeNull();
    // The MEDICINE_DISPENSED timeline event still anchors on the real
    // INVENTORY dispense time, never on the custom item.
    const dispenseEvent = report.events.find((e) => e.type === 'MEDICINE_DISPENSED')!;
    expect(dispenseEvent.timestamp).toBe(new Date('2026-02-01T12:00:00Z').toISOString());
  });

  it('hides all billing figures and payment events when the caller lacks Charge:read', async () => {
    const report = await service.getPatientTimeline('emp-uuid-1', { canViewBilling: false });
    expect(report.billing).toEqual({ authorized: false, total: 0, paid: 0, pending: 0 });
    expect(mockCharge.patientLedger).not.toHaveBeenCalled();
    expect(report.events.some((e) => e.type === 'PAYMENT')).toBe(false);
    expect(report.summary.totalBills).toBe(0);
  });

  it('shows billing figures and payment events when authorized', async () => {
    const report = await service.getPatientTimeline('emp-uuid-1', { canViewBilling: true });
    expect(report.billing).toEqual({ authorized: true, total: 1500, paid: 1000, pending: 500 });
    expect(report.events.some((e) => e.type === 'PAYMENT')).toBe(true);
  });
});

describe('renderPatientHistoryHtml (clinical report PDF)', () => {
  const branding = { hospitalName: 'ESIC Hospital', tagline: 'Care', primaryColor: '#005691' };
  const base: any = {
    patient: {
      uhid: 'HSP00000001',
      employeeId: 'EMP-1001',
      name: 'Rajesh Kumar',
      age: '36 Yrs',
      gender: 'MALE',
      dob: '1990-06-15',
      mobile: '+91',
      address: 'Addr',
      employmentType: 'Permanent',
    },
    hospitalName: 'ESIC Hospital',
    period: { from: new Date('2026-02-01T09:00:00Z').toISOString(), to: new Date('2026-02-08T11:00:00Z').toISOString() },
    summary: {
      totalVisits: 1,
      totalAdmissions: 1,
      totalConsultations: 1,
      totalLabOrders: 1,
      totalPrescriptions: 1,
      totalMedicines: 2,
      totalProcedures: 0,
      totalTherapySessions: 1,
      totalBills: 1,
    },
    events: [
      {
        type: 'PROGRESS_NOTE',
        title: 'Progress Note',
        timestamp: new Date('2026-02-06T09:00:00Z').toISOString(),
        timeRecorded: true,
        department: 'Cardiology',
        location: null,
        performedBy: 'Nurse Asha',
        performedByRole: 'Nurse',
        status: null,
      },
    ],
    medicationHistory: [
      {
        medicineName: 'Himalaya Arjuna capsules',
        medicineType: 'CUSTOM',
        stage: 'DISPENSED',
        timestamp: null,
        timeRecorded: false,
        dose: '1 cap',
        frequency: 'BD',
        duration: '15 days',
        quantity: 30,
        by: null,
        notRecordedReason: 'No dispense transaction record found for this item.',
      },
    ],
    billing: { authorized: false, total: 0, paid: 0, pending: 0 },
    generatedAt: new Date().toISOString(),
  };

  it('renders the correct patient, custom-medicine chip, not-recorded times, and hides billing when unauthorized', () => {
    const html = renderPatientHistoryHtml(branding, base);
    expect(html).toContain('Rajesh Kumar');
    expect(html).toContain('EMP-1001');
    expect(html).toContain('Progress Note');
    expect(html).toContain('(Custom)');
    expect(html).toContain('Time not recorded');
    expect(html).toContain('Not authorized to view billing');
    expect(html).not.toContain('₹1500');
  });

  it('escapes patient-controlled HTML instead of rendering it', () => {
    const evil = structuredClone(base);
    evil.patient.name = '<script>alert(1)</script>';
    const html = renderPatientHistoryHtml(branding, evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
