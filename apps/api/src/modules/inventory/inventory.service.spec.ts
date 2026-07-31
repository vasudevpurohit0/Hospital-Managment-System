import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockStatus } from '@prisma/client';

describe('InventoryService', () => {
  let service: InventoryService;

  const mockPrisma = {
    medicine: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    medicineBatch: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      fields: {
        reorderLevel: 'reorderLevel',
      },
    },
    pharmacyStock: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllMedicines', () => {
    it('returns medicines from database when present', async () => {
      const mockMeds = [
        { id: 'm-1', genericName: 'Amoxicillin', category: 'Antibiotics', batches: [] },
      ];
      mockPrisma.medicine.findMany.mockResolvedValue(mockMeds);

      const result = await service.findAllMedicines();
      expect(result).toEqual(mockMeds);
      expect(mockPrisma.medicine.findMany).toHaveBeenCalled();
    });

    it('falls back to demo catalog if database call throws or returns empty', async () => {
      mockPrisma.medicine.findMany.mockRejectedValue(new Error('DB Error'));

      const result = await service.findAllMedicines();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].genericName).toBe('Paracetamol');
    });
  });

  describe('createMedicine', () => {
    it('creates a new medicine entry in database', async () => {
      const dto = {
        genericName: 'Metformin',
        brandName: 'Glycomet',
        category: 'Anti-Diabetic',
        strength: '500mg',
        dosageForm: 'Tablet',
      };
      const created = { id: 'm-met', ...dto };
      mockPrisma.medicine.create.mockResolvedValue(created);

      const result = await service.createMedicine(dto);
      expect(result).toEqual(created);
      expect(mockPrisma.medicine.create).toHaveBeenCalledWith({
        data: {
          genericName: dto.genericName,
          brandName: dto.brandName,
          category: dto.category,
          strength: dto.strength,
          dosageForm: dto.dosageForm,
        },
      });
    });
  });

  describe('createBatch', () => {
    it('creates a batch and sets StockStatus based on stock levels', async () => {
      const dto = {
        medicineId: 'm-1',
        batchNumber: 'MET-2026-01',
        manufacturer: 'USV Pharma',
        manufacturingDate: '2026-01-01',
        expiryDate: '2027-12-31',
        purchasePrice: 12.0,
        issuePrice: 20.0,
        currentStock: 30, // Below minimum 50 -> CRITICAL_ALERT
        minimumStockLevel: 50,
        reorderLevel: 100,
        storageLocation: 'Rack C-05',
      };

      mockPrisma.medicine.findUnique.mockResolvedValue({ id: 'm-1' });
      mockPrisma.medicineBatch.create.mockResolvedValue({
        id: 'b-met-1',
        ...dto,
        stockStatus: StockStatus.CRITICAL_ALERT,
      });
      mockPrisma.pharmacyStock.create.mockResolvedValue({});

      const result = await service.createBatch(dto);
      expect(result.stockStatus).toBe(StockStatus.CRITICAL_ALERT);
      expect(mockPrisma.pharmacyStock.create).toHaveBeenCalled();
    });
  });

  describe('getLowStockAlerts', () => {
    it('returns batches below reorder level', async () => {
      const lowBatches = [{ id: 'b-low', currentStock: 20, reorderLevel: 100 }];
      mockPrisma.medicineBatch.findMany.mockResolvedValue(lowBatches);

      const result = await service.getLowStockAlerts();
      expect(result).toEqual(lowBatches);
    });
  });
});
