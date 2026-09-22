import { HospitalSettingsController } from './hospital-settings.controller';
import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

describe('HospitalSettingsController caching', () => {
  let controller: HospitalSettingsController;
  let prisma: { hospitalSettings: Record<string, jest.Mock> };
  let redis: { getJson: jest.Mock; setJson: jest.Mock; del: jest.Mock };

  const HOSPITAL_A = 'hospital-a';
  const HOSPITAL_B = 'hospital-b';
  const settings = { id: 'singleton', currency: 'INR', taxPercent: 5 };

  function withTenant<T>(hospitalId: string, fn: () => T): T {
    return runWithTenant({ hospitalId, schemaName: `hospital_${hospitalId}`, prismaClient: {} as any }, fn);
  }

  beforeEach(() => {
    prisma = {
      hospitalSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
        upsert: jest.fn().mockResolvedValue({ ...settings, taxPercent: 10 }),
      },
    };
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    controller = new HospitalSettingsController(prisma as unknown as PrismaService, redis as unknown as RedisService);
  });

  it('cache miss: reads from the database and populates a tenant-scoped cache key', async () => {
    await withTenant(HOSPITAL_A, () => controller.getSettings());
    expect(prisma.hospitalSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A), settings, expect.any(Number));
  });

  it('cache hit: returns the cached value without touching the database', async () => {
    redis.getJson.mockResolvedValueOnce(settings);
    const result = await withTenant(HOSPITAL_A, () => controller.getSettings());
    expect(result).toEqual(settings);
    expect(prisma.hospitalSettings.findUnique).not.toHaveBeenCalled();
  });

  it('tenant isolation: hospital A and hospital B never share a cache key', async () => {
    await withTenant(HOSPITAL_A, () => controller.getSettings());
    await withTenant(HOSPITAL_B, () => controller.getSettings());

    const keys = redis.setJson.mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it('updateSettings() invalidates the tenant-scoped cache', async () => {
    await withTenant(HOSPITAL_A, () => controller.updateSettings({ taxPercent: 10 } as any, { user: { sub: 'u1' } }));
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A));
  });
});
