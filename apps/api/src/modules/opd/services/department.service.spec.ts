import { DepartmentService } from './department.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { runWithTenant } from '../../../common/tenant/tenant-context';

describe('DepartmentService caching', () => {
  let service: DepartmentService;
  let prisma: { department: Record<string, jest.Mock> };
  let redis: { getJson: jest.Mock; setJson: jest.Mock; del: jest.Mock };

  const HOSPITAL_A = 'hospital-a';
  const HOSPITAL_B = 'hospital-b';
  const dept = { id: 'd1', name: 'Cardiology', code: 'CARDIO', active: true };

  function withTenant<T>(hospitalId: string, fn: () => T): T {
    return runWithTenant({ hospitalId, schemaName: `hospital_${hospitalId}`, prismaClient: {} as any }, fn);
  }

  beforeEach(() => {
    prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([dept]),
        findUnique: jest.fn().mockResolvedValue(dept),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(dept),
        update: jest.fn().mockResolvedValue({ ...dept, name: 'Updated' }),
        count: jest.fn().mockResolvedValue(2),
      },
    };
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    service = new DepartmentService(prisma as unknown as PrismaService, redis as unknown as RedisService);
  });

  it('cache miss: reads from the database and populates the cache with a tenant-scoped key', async () => {
    await withTenant(HOSPITAL_A, () => service.findAll());
    expect(prisma.department.findMany).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A), [dept], expect.any(Number));
  });

  it('cache hit: returns the cached value without touching the database', async () => {
    redis.getJson.mockResolvedValueOnce([dept]);
    const result = await withTenant(HOSPITAL_A, () => service.findAll());
    expect(result).toEqual([dept]);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });

  it('tenant isolation: hospital A and hospital B use different cache keys', async () => {
    await withTenant(HOSPITAL_A, () => service.findAll());
    await withTenant(HOSPITAL_B, () => service.findAll());

    const keys = redis.setJson.mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[0]).toContain(HOSPITAL_A);
    expect(keys[1]).toContain(HOSPITAL_B);
  });

  it('includeInactive=true bypasses the cache entirely (admin roster path)', async () => {
    await withTenant(HOSPITAL_A, () => service.findAll(true));
    expect(redis.getJson).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(prisma.department.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('create() invalidates the tenant-scoped cache', async () => {
    await withTenant(HOSPITAL_A, () =>
      service.create({ name: 'Neurology', code: 'NEURO' } as any),
    );
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A));
  });

  it('update() invalidates the tenant-scoped cache', async () => {
    await withTenant(HOSPITAL_A, () => service.update('d1', { name: 'Updated' } as any));
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A));
  });

  it('setActive() invalidates the tenant-scoped cache', async () => {
    await withTenant(HOSPITAL_A, () => service.setActive('d1', false));
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(HOSPITAL_A));
  });
});
