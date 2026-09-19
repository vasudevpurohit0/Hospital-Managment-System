import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../tenant/tenant-context';

function contextFor(
  overrides: { method?: string; path?: string; body?: unknown; user?: unknown; ip?: string; userAgent?: string } = {},
): ExecutionContext {
  const request = {
    method: overrides.method ?? 'POST',
    body: overrides.body ?? {},
    params: {},
    url: overrides.path ?? '/api/opd-visits',
    route: { path: overrides.path ?? '/api/opd-visits' },
    user: overrides.user,
    ip: overrides.ip,
    headers: overrides.userAgent ? { 'user-agent': overrides.userAgent } : {},
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const handler = (body: unknown = { id: 'e1' }): CallHandler => ({ handle: () => of(body) });
const failingHandler = (err: unknown = new Error('boom')): CallHandler => ({ handle: () => throwError(() => err) });
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('AuditInterceptor', () => {
  let create: jest.Mock;
  let interceptor: AuditInterceptor;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    interceptor = new AuditInterceptor({ auditLog: { create } } as unknown as PrismaService);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // Platform-scoped mutations carry no hospital, so no tenant context exists
  // and the tenant-aware PrismaService proxy would throw. They used to log a
  // "Failed to write AuditLog" error on every single platform action.
  it('skips without error when no tenant context is set', async () => {
    const ctx = contextFor({
      method: 'POST',
      path: '/api/platform/admins',
      user: { id: 'p1', roleName: 'SuperAdmin', type: 'platform' },
    });

    await lastValueFrom(interceptor.intercept(ctx, handler()));
    await flush();

    expect(create).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('no tenant context'));
  });

  it('writes the AuditLog when a tenant context is present', async () => {
    const ctx = contextFor({
      method: 'POST',
      path: '/api/opd-visits',
      user: { id: 'u1', roleName: 'Reception' },
    });

    await runWithTenant(
      { hospitalId: 'h1', schemaName: 'hospital_test', prismaClient: {} as never },
      () => lastValueFrom(interceptor.intercept(ctx, handler())),
    );
    await flush();

    expect(create).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignores non-mutating methods entirely', async () => {
    await lastValueFrom(interceptor.intercept(contextFor({ method: 'GET' }), handler()));
    await flush();

    expect(create).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('captures ip/browser/os/device and a generated description on success', async () => {
    const ctx = contextFor({
      method: 'POST',
      path: '/api/notices',
      user: { id: 'u1', roleName: 'Administrator' },
      ip: '49.43.6.216',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
    });

    await runWithTenant(
      { hospitalId: 'h1', schemaName: 'hospital_test', prismaClient: {} as never },
      () => lastValueFrom(interceptor.intercept(ctx, handler({ id: 'e1', title: 'PMVY scholarship notice' }))),
    );
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          severity: 'LOW',
          ipAddress: '49.43.6.216',
          browser: 'Chrome 153',
          os: 'Windows 10/11',
          device: 'Desktop',
          description: expect.stringContaining('PMVY scholarship notice'),
        }),
      }),
    );
  });

  it('reports changed fields on an update', async () => {
    const ctx = contextFor({
      method: 'PATCH',
      path: '/api/notices/e1',
      body: { title: 'New Title', type: 'GENERAL' },
      user: { id: 'u1', roleName: 'Administrator' },
    });

    await runWithTenant(
      { hospitalId: 'h1', schemaName: 'hospital_test', prismaClient: {} as never },
      () => lastValueFrom(interceptor.intercept(ctx, handler({ id: 'e1', title: 'Old Title', type: 'GENERAL' }))),
    );
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changedFields: ['title'] }),
      }),
    );
  });

  it('writes a FAILURE-status entry with a real tenant context when the handler throws', async () => {
    const ctx = contextFor({
      method: 'DELETE',
      path: '/api/staff/e1',
      user: { id: 'u1', roleName: 'Administrator' },
    });

    await runWithTenant(
      { hospitalId: 'h1', schemaName: 'hospital_test', prismaClient: {} as never },
      async () => {
        await expect(lastValueFrom(interceptor.intercept(ctx, failingHandler(new Error('locked'))))).rejects.toThrow('locked');
      },
    );
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILURE', severity: 'HIGH', description: expect.stringContaining('locked') }),
      }),
    );
  });

  it('skips failure logging too when no tenant context is set', async () => {
    const ctx = contextFor({ method: 'DELETE', path: '/api/platform/admins/e1', user: { id: 'p1', roleName: 'SuperAdmin' } });

    await expect(lastValueFrom(interceptor.intercept(ctx, failingHandler()))).rejects.toThrow('boom');
    await flush();

    expect(create).not.toHaveBeenCalled();
  });
});
