import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateBrandingDto } from './update-branding.dto';

/** V-16 regression: PUT /branding used to be typed `@Body() body: any`, so the global ValidationPipe had nothing to validate against. */
describe('UpdateBrandingDto (regression: V-16)', () => {
  async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(UpdateBrandingDto, body));
  }

  it('accepts a real 6-digit hex primaryColor', async () => {
    const errors = await validateBody({ primaryColor: '#005691' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a style-block-breakout payload as primaryColor', async () => {
    const errors = await validateBody({ primaryColor: "red } </style><script>alert(1)</script><style>" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('primaryColor');
  });

  it('rejects a non-hex garbage primaryColor', async () => {
    const errors = await validateBody({ primaryColor: 'not-a-color' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a fully-omitted body (every field optional)', async () => {
    const errors = await validateBody({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid hospitalName/tagline/logoUrl combination', async () => {
    const errors = await validateBody({
      hospitalName: 'ESIC Model Hospital',
      tagline: 'Chinta Se Mukti',
      logoUrl: 'https://example.com/logo.png',
    });
    expect(errors).toHaveLength(0);
  });
});
