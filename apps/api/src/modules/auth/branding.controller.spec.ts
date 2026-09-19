import { BrandingController, DEFAULT_BRANDING } from './branding.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

describe('BrandingController', () => {
  let findUnique: jest.Mock;
  let controller: BrandingController;

  beforeEach(() => {
    findUnique = jest.fn();
    const prismaStub = { brandingConfig: { findUnique } } as unknown as PrismaService;
    controller = new BrandingController(prismaStub);
  });

  // The login page calls GET /branding before anyone holds a token, so the
  // tenant middleware sets no context. Reading through PrismaService here
  // threw "No tenant context set for this execution" and surfaced as a 500.
  it('returns the platform defaults when no tenant context is set', async () => {
    await expect(controller.getBranding()).resolves.toEqual(DEFAULT_BRANDING);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("reads the tenant's own row when a tenant context is set", async () => {
    const row = { id: 'singleton', ...DEFAULT_BRANDING };
    findUnique.mockResolvedValue(row);

    const result = await runWithTenant(
      { hospitalId: 'h1', schemaName: 'hospital_test', prismaClient: {} as never },
      () => controller.getBranding(),
    );

    expect(result).toEqual(row);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });
});
