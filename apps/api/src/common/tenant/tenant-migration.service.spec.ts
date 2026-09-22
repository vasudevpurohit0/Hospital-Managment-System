import { Test, TestingModule } from '@nestjs/testing';
import { TenantMigrationService } from './tenant-migration.service';
import { PlatformPrismaService } from './platform-prisma.service';

describe('TenantMigrationService (startup reconciliation for tenant-schema drift)', () => {
  let service: TenantMigrationService;

  const mockPlatformPrisma = {
    hospital: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantMigrationService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
      ],
    }).compile();

    service = module.get<TenantMigrationService>(TenantMigrationService);
    jest.clearAllMocks();
    delete process.env.SKIP_STARTUP_MIGRATION;
  });

  afterEach(() => {
    delete process.env.SKIP_STARTUP_MIGRATION;
  });

  function stubMigrations(opts: { platformFails?: boolean; failingSchemas?: string[] } = {}) {
    jest
      .spyOn(service, 'migratePlatformSchema')
      .mockImplementation(() => (opts.platformFails ? Promise.reject(new Error('platform migrate failed')) : Promise.resolve()));
    const migrateTenant = jest.spyOn(service, 'migrateTenantSchema').mockImplementation((schemaName: string) => {
      if (opts.failingSchemas?.includes(schemaName)) return Promise.reject(new Error(`migrate failed for ${schemaName}`));
      return Promise.resolve();
    });
    return migrateTenant;
  }

  it('migrates the platform schema and every listed tenant, returning a full-migrated summary', async () => {
    mockPlatformPrisma.hospital.findMany.mockResolvedValue([
      { id: 'h-1', slug: 'esic-gwalior', schemaName: 'hospital_esic_gwalior' },
      { id: 'h-2', slug: 'esic-bpl', schemaName: 'hospital_esic_bpl' },
    ]);
    const migrateTenant = stubMigrations();

    const summary = await service.reconcile();

    expect(service.migratePlatformSchema).toHaveBeenCalledTimes(1);
    expect(mockPlatformPrisma.hospital.findMany).toHaveBeenCalledWith({
      where: { status: { not: 'PROVISIONING' } },
      select: { id: true, slug: true, schemaName: true },
    });
    expect(migrateTenant).toHaveBeenCalledWith('hospital_esic_gwalior');
    expect(migrateTenant).toHaveBeenCalledWith('hospital_esic_bpl');
    expect(summary).toEqual({ migrated: ['hospital_esic_gwalior', 'hospital_esic_bpl'], failed: [], skipped: [] });
  });

  it('isolates a per-tenant failure: records it, continues with the rest, never throws', async () => {
    mockPlatformPrisma.hospital.findMany.mockResolvedValue([
      { id: 'h-1', slug: 'bad-one', schemaName: 'hospital_bad_one' },
      { id: 'h-2', slug: 'good-one', schemaName: 'hospital_good_one' },
    ]);
    stubMigrations({ failingSchemas: ['hospital_bad_one'] });

    const summary = await service.reconcile();

    expect(summary.migrated).toEqual(['hospital_good_one']);
    expect(summary.failed).toEqual([
      { schemaName: 'hospital_bad_one', error: expect.stringContaining('hospital_bad_one') },
    ]);
    expect(summary.skipped).toEqual([]);
  });

  it('skips rows with an invalid schemaName instead of running DDL against them', async () => {
    mockPlatformPrisma.hospital.findMany.mockResolvedValue([
      { id: 'h-1', slug: 'evil', schemaName: 'public"; DROP TABLE users; --' },
      { id: 'h-2', slug: 'fine', schemaName: 'hospital_fine' },
    ]);
    const migrateTenant = stubMigrations();

    const summary = await service.reconcile();

    expect(migrateTenant).not.toHaveBeenCalledWith('public"; DROP TABLE users; --');
    expect(migrateTenant).toHaveBeenCalledWith('hospital_fine');
    expect(summary.skipped).toEqual(['public"; DROP TABLE users; --']);
    expect(summary.migrated).toEqual(['hospital_fine']);
  });

  it('still reconciles tenants when the platform-schema migration itself fails', async () => {
    mockPlatformPrisma.hospital.findMany.mockResolvedValue([
      { id: 'h-1', slug: 'esic-gwalior', schemaName: 'hospital_esic_gwalior' },
    ]);
    const migrateTenant = stubMigrations({ platformFails: true });

    const summary = await service.reconcile();

    expect(migrateTenant).toHaveBeenCalledWith('hospital_esic_gwalior');
    expect(summary.migrated).toEqual(['hospital_esic_gwalior']);
  });

  it('returns an empty summary without throwing when the hospital listing fails', async () => {
    mockPlatformPrisma.hospital.findMany.mockRejectedValue(new Error('platform db down'));
    const migrateTenant = stubMigrations();

    const summary = await service.reconcile();

    expect(migrateTenant).not.toHaveBeenCalled();
    expect(summary).toEqual({ migrated: [], failed: [], skipped: [] });
  });

  it('migrateTenantSchema refuses an invalid schema name before touching the shell', async () => {
    await expect(service.migrateTenantSchema('public"; DROP SCHEMA x; --')).rejects.toThrow('refusing to run DDL');
  });

  it('onModuleInit does nothing when SKIP_STARTUP_MIGRATION=true', () => {
    process.env.SKIP_STARTUP_MIGRATION = 'true';
    const reconcile = jest.spyOn(service, 'reconcile');

    service.onModuleInit();

    expect(reconcile).not.toHaveBeenCalled();
  });

  it('onModuleInit kicks off reconciliation without blocking (does not return a promise to await)', () => {
    const reconcile = jest.spyOn(service, 'reconcile').mockResolvedValue({ migrated: [], failed: [], skipped: [] });

    const result = service.onModuleInit();

    expect(result).toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
