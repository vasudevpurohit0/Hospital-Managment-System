import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { RedisService } from '../common/redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let redis: { ping: jest.Mock };

  beforeEach(async () => {
    redis = { ping: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: RedisService, useValue: redis }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check()', () => {
    it('should return health status with required fields', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      expect(result.uptime).toBeDefined();
      expect(typeof result.uptime).toBe('number');
      expect(result.version).toBeDefined();
    });

    it('should return a valid ISO timestamp', () => {
      const result = controller.check();
      const parsed = new Date(result.timestamp);
      expect(parsed.toISOString()).toBe(result.timestamp);
    });

    it('should return non-negative uptime', () => {
      const result = controller.check();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dependencies()', () => {
    it('reports redis "up" when the ping succeeds', async () => {
      redis.ping.mockResolvedValueOnce(true);
      await expect(controller.dependencies()).resolves.toEqual({ redis: 'up' });
    });

    it('reports redis "down" when the ping fails, and never throws', async () => {
      redis.ping.mockResolvedValueOnce(false);
      await expect(controller.dependencies()).resolves.toEqual({ redis: 'down' });
    });
  });
});
