import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrescriptionItemMedicineType } from '@prisma/client';
import { CreatePrescriptionItemDto } from './create-prescription-item.dto';

describe('CreatePrescriptionItemDto (Custom Medicine)', () => {
  const validCustomBody = {
    medicineType: PrescriptionItemMedicineType.CUSTOM,
    medicineName: 'Amoxicillin 500mg',
    dose: '1 Capsule',
    frequency: '1-0-1',
    duration: '5 Days',
  };

  async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(CreatePrescriptionItemDto, body));
  }

  it('accepts a valid custom medicine item', async () => {
    expect(await validateBody(validCustomBody)).toHaveLength(0);
  });

  it('accepts a valid inventory medicine item with medicineType omitted (defaults server-side)', async () => {
    expect(
      await validateBody({
        medicineName: 'Paracetamol 650mg',
        dose: '1 Tablet',
        frequency: '1-0-1',
        duration: '5 Days',
      }),
    ).toHaveLength(0);
  });

  it('rejects an empty medicine name', async () => {
    const errors = await validateBody({ ...validCustomBody, medicineName: '' });
    expect(errors.some((e) => e.property === 'medicineName')).toBe(true);
  });

  it('rejects a whitespace-only medicine name', async () => {
    const errors = await validateBody({ ...validCustomBody, medicineName: '   ' });
    expect(errors.some((e) => e.property === 'medicineName')).toBe(true);
  });

  it('rejects an empty dose', async () => {
    const errors = await validateBody({ ...validCustomBody, dose: '' });
    expect(errors.some((e) => e.property === 'dose')).toBe(true);
  });

  it('rejects an empty frequency', async () => {
    const errors = await validateBody({ ...validCustomBody, frequency: '' });
    expect(errors.some((e) => e.property === 'frequency')).toBe(true);
  });

  it('rejects an empty duration', async () => {
    const errors = await validateBody({ ...validCustomBody, duration: '' });
    expect(errors.some((e) => e.property === 'duration')).toBe(true);
  });

  it('rejects a medicine name longer than the maximum allowed length', async () => {
    const errors = await validateBody({ ...validCustomBody, medicineName: 'A'.repeat(201) });
    expect(errors.some((e) => e.property === 'medicineName')).toBe(true);
  });

  it('rejects a medicineType outside the enum', async () => {
    const errors = await validateBody({ ...validCustomBody, medicineType: 'NOT_A_REAL_TYPE' });
    expect(errors.some((e) => e.property === 'medicineType')).toBe(true);
  });

  it('trims surrounding whitespace from a valid medicine name before validating', async () => {
    const instance = plainToInstance(CreatePrescriptionItemDto, {
      ...validCustomBody,
      medicineName: '  Amoxicillin 500mg  ',
    });
    expect(instance.medicineName).toBe('Amoxicillin 500mg');
    expect(await validate(instance)).toHaveLength(0);
  });
});
