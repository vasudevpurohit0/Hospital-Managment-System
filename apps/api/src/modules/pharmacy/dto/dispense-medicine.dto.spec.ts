import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DispenseMedicineDto } from './dispense-medicine.dto';

describe('DispenseMedicineDto', () => {
  const validItem = {
    prescriptionItemId: '11111111-1111-4111-8111-111111111111',
    medicineBatchId: '22222222-2222-4222-8222-222222222222',
    dispenseQuantity: 2,
  };
  const validBody = {
    prescriptionId: '33333333-3333-4333-8333-333333333333',
    items: [validItem],
  };

  async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(DispenseMedicineDto, body));
  }

  it('accepts a valid dispense request', async () => {
    expect(await validateBody(validBody)).toHaveLength(0);
  });

  // Regression: dispenseQuantity previously had no lower-bound check.
  // PharmacyService.dispense() uses it directly in a Prisma `decrement` and
  // in a `{ gte: dispenseQuantity }` insufficient-stock guard -- a zero or
  // negative value made that guard vacuously pass (any stock is `>=` a
  // negative number) and turned the "decrement" into a net stock *increase*,
  // silently inflating inventory instead of dispensing it.
  it('rejects a negative dispenseQuantity', async () => {
    const errors = await validateBody({
      ...validBody,
      items: [{ ...validItem, dispenseQuantity: -5 }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a zero dispenseQuantity', async () => {
    const errors = await validateBody({
      ...validBody,
      items: [{ ...validItem, dispenseQuantity: 0 }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-UUID prescriptionId', async () => {
    const errors = await validateBody({ ...validBody, prescriptionId: 'not-a-uuid' });
    expect(errors.some((e) => e.property === 'prescriptionId')).toBe(true);
  });

  it('rejects a non-UUID prescriptionItemId', async () => {
    const errors = await validateBody({
      ...validBody,
      items: [{ ...validItem, prescriptionItemId: 'not-a-uuid' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-UUID medicineBatchId', async () => {
    const errors = await validateBody({
      ...validBody,
      items: [{ ...validItem, medicineBatchId: 'not-a-uuid' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows medicineBatchId to be omitted (a CUSTOM item has no batch)', async () => {
    const { medicineBatchId, ...customItem } = validItem;
    expect(await validateBody({ ...validBody, items: [customItem] })).toHaveLength(0);
  });
});
