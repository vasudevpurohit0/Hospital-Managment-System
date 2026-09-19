import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateHospitalSettingsDto } from './update-hospital-settings.dto';

/** V-20 regression: PUT /settings/hospital used to be typed `Partial<typeof DEFAULT_HOSPITAL_SETTINGS>`, a TS-only type invisible to the runtime ValidationPipe. */
describe('UpdateHospitalSettingsDto (regression: V-20)', () => {
  async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(UpdateHospitalSettingsDto, body));
  }

  it('accepts a fully-omitted body (every field optional)', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('accepts a valid full update', async () => {
    const errors = await validateBody({
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      workingDays: ['MON', 'TUE', 'WED'],
      currency: 'INR',
      taxPercent: 12,
      billingPrefix: 'INV',
      notifyOnAdmission: true,
      notifyOnDischarge: false,
      notifyOnLowStock: true,
      sendTemporaryPasswordByEmail: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a workingDays entry outside the real day codes', async () => {
    const errors = await validateBody({ workingDays: ['MON', 'FUNDAY'] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('workingDays');
  });

  it('rejects a taxPercent outside 0-100', async () => {
    const errors = await validateBody({ taxPercent: 150 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('taxPercent');
  });

  it('rejects a non-boolean notification flag', async () => {
    const errors = await validateBody({ notifyOnAdmission: 'yes' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('notifyOnAdmission');
  });
});
