import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BenefitOutcome } from '@prisma/client';
import { UpdateBenefitRuleDto } from './update-benefit-rule.dto';

/** V-20 regression: PUT /benefit-rules/:id used to be typed `Partial<CreateBenefitRuleDto>`, a TS-only type invisible to the runtime ValidationPipe. */
describe('UpdateBenefitRuleDto (regression: V-20)', () => {
  async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(UpdateBenefitRuleDto, body));
  }

  it('accepts a fully-omitted body (every field optional)', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('accepts a valid partial update', async () => {
    expect(await validateBody({ outcome: BenefitOutcome.FREE, active: false })).toHaveLength(0);
  });

  it('rejects an outcome outside the BenefitOutcome enum', async () => {
    const errors = await validateBody({ outcome: 'NOT_A_REAL_OUTCOME' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('outcome');
  });

  it('rejects a non-boolean active value', async () => {
    const errors = await validateBody({ active: 'yes-please' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('active');
  });
});
