import { Test, TestingModule } from '@nestjs/testing';
import { PrescriptionService } from './prescription.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LabService } from '../laboratory/lab.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { ForbiddenException } from '@nestjs/common';
import { PrescriptionStatus, PrescriptionItemMedicineType } from '@prisma/client';

describe('PrescriptionService', () => {
  let service: PrescriptionService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    diagnosis: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    prescription: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    prescriptionItem: {
      deleteMany: jest.fn(),
    },
    labOrder: {
      create: jest.fn(),
    },
    admission: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    visit: {
      findUnique: jest.fn().mockResolvedValue({ id: 'v-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrescriptionService,
        { provide: PrismaService, useValue: mockPrismaService },
        // Lab ordering moved to LabService in P3; this suite predates it and
        // doesn't exercise the labTestIds path, so a stub is sufficient.
        { provide: LabService, useValue: { orderTests: jest.fn() } },
        {
          provide: DocumentSequenceService,
          useValue: { next: jest.fn().mockResolvedValue('IPD/2026/000001') },
        },
      ],
    }).compile();

    service = module.get<PrescriptionService>(PrescriptionService);
    jest.clearAllMocks();
  });

  it('should create a draft prescription with items and lab orders', async () => {
    mockPrismaService.diagnosis.create.mockResolvedValue({ id: 'dx-1' });
    mockPrismaService.prescription.create.mockResolvedValue({
      id: 'rx-1',
      status: PrescriptionStatus.DRAFT,
      items: [{ id: 'i-1', medicineName: 'Paracetamol', dose: '500mg' }],
    });

    const result = await service.createPrescription(
      {
        visitId: 'v-1001',
        diagnosisText: 'Fever',
        items: [
          { medicineName: 'Paracetamol', dose: '500mg', frequency: '1-0-1', duration: '5 days' },
        ],
        labTestIds: ['lt-cbc-1'],
      },
      'doc-101',
    );

    expect(result.prescription.id).toBe('rx-1');
  });

  it('should reject editing a signed prescription with ForbiddenException (Immutability Enforcement)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-signed',
      status: PrescriptionStatus.SIGNED,
    });

    await expect(
      service.updatePrescription('rx-signed', {
        items: [{ medicineName: 'Paracetamol', dose: '500mg', frequency: '1-0-1', duration: '5 days' }],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockPrismaService.prescriptionItem.deleteMany).not.toHaveBeenCalled();
  });

  it('should actually persist edited items to the database (regression: update previously returned success without writing)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-draft',
      status: PrescriptionStatus.DRAFT,
    });
    mockPrismaService.prescription.update.mockResolvedValue({
      id: 'rx-draft',
      status: PrescriptionStatus.DRAFT,
      items: [{ id: 'i-new', medicineName: 'Ibuprofen', dose: '400mg', frequency: '1-1-1', duration: '3 days' }],
    });

    const result = await service.updatePrescription('rx-draft', {
      items: [{ medicineName: 'Ibuprofen', dose: '400mg', frequency: '1-1-1', duration: '3 days' }],
    });

    expect(mockPrismaService.prescriptionItem.deleteMany).toHaveBeenCalledWith({
      where: { prescriptionId: 'rx-draft' },
    });
    expect(mockPrismaService.prescription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rx-draft' },
        data: expect.objectContaining({
          items: {
            create: [
              {
                medicineName: 'Ibuprofen',
                medicineType: PrescriptionItemMedicineType.INVENTORY,
                dose: '400mg',
                frequency: '1-1-1',
                duration: '3 days',
              },
            ],
          },
        }),
      }),
    );
    expect(result.items[0].medicineName).toBe('Ibuprofen');
  });

  it('defaults medicineType to INVENTORY when the item omits it', async () => {
    mockPrismaService.diagnosis.create.mockResolvedValue({ id: 'dx-2' });
    mockPrismaService.prescription.create.mockResolvedValue({
      id: 'rx-2',
      status: PrescriptionStatus.DRAFT,
      items: [{ id: 'i-2', medicineName: 'Paracetamol', medicineType: PrescriptionItemMedicineType.INVENTORY }],
    });

    await service.createPrescription(
      {
        visitId: 'v-1001',
        diagnosisText: 'Fever',
        items: [{ medicineName: 'Paracetamol', dose: '500mg', frequency: '1-0-1', duration: '5 days' }],
      },
      'doc-101',
    );

    expect(mockPrismaService.prescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                medicineName: 'Paracetamol',
                medicineType: PrescriptionItemMedicineType.INVENTORY,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('persists a CUSTOM medicine item exactly as flagged, alongside an INVENTORY item in the same prescription', async () => {
    mockPrismaService.diagnosis.create.mockResolvedValue({ id: 'dx-3' });
    mockPrismaService.prescription.create.mockResolvedValue({
      id: 'rx-3',
      status: PrescriptionStatus.DRAFT,
      items: [
        { id: 'i-3a', medicineName: 'Paracetamol 650mg', medicineType: PrescriptionItemMedicineType.INVENTORY },
        { id: 'i-3b', medicineName: 'Amoxicillin 500mg', medicineType: PrescriptionItemMedicineType.CUSTOM },
      ],
    });

    await service.createPrescription(
      {
        visitId: 'v-1001',
        diagnosisText: 'Infection with fever',
        items: [
          {
            medicineName: 'Paracetamol 650mg',
            medicineType: PrescriptionItemMedicineType.INVENTORY,
            dose: '1 Tablet',
            frequency: '1-0-1',
            duration: '5 Days',
          },
          {
            medicineName: 'Amoxicillin 500mg',
            medicineType: PrescriptionItemMedicineType.CUSTOM,
            dose: '1 Capsule',
            frequency: '1-0-1',
            duration: '5 Days',
          },
        ],
      },
      'doc-101',
    );

    expect(mockPrismaService.prescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({ medicineName: 'Paracetamol 650mg', medicineType: PrescriptionItemMedicineType.INVENTORY }),
              expect.objectContaining({ medicineName: 'Amoxicillin 500mg', medicineType: PrescriptionItemMedicineType.CUSTOM }),
            ],
          },
        }),
      }),
    );
  });

  it('should reject signing if user does not hold Doctor or SuperAdmin role (FR-DOC-07)', async () => {
    await expect(service.signPrescription('rx-1', 'Reception')).rejects.toThrow(ForbiddenException);
  });

  it('should sign prescription and create Admission stub when admissionRecommended is true', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      visitId: 'v-1001',
      status: PrescriptionStatus.DRAFT,
      items: [],
    });
    mockPrismaService.prescription.update.mockResolvedValue({
      id: 'rx-1',
      status: PrescriptionStatus.SIGNED,
      signedAt: new Date(),
    });
    mockPrismaService.diagnosis.findFirst.mockResolvedValue({
      id: 'dx-1',
      visitId: 'v-1001',
      admissionRecommended: true,
    });
    mockPrismaService.admission.findFirst.mockResolvedValue(null);
    mockPrismaService.admission.create.mockResolvedValue({ id: 'adm-stub-1', status: 'REQUESTED' });

    const result = await service.signPrescription('rx-1', 'Doctor');

    expect(result.status).toBe(PrescriptionStatus.SIGNED);
    expect(mockPrismaService.admission.create).toHaveBeenCalled();
  });
});
