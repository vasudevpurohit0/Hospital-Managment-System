import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../tenant/tenant-context';

function contextFor(
  overrides: { method?: string; path?: string; body?: unknown; user?: unknown } = {},
): ExecutionContext {
  const request = {
    method: overrides.method ?? 'POST',
    body: overrides.body ?? {},
    params: {},
    url: overrides.path ?? '/api/opd-visits',
    route: { path: overrides.path ?? '/api/opd-visits' },
    user: overrides.user,
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const handler = (body: unknown = { id: 'e1' }): CallHandler => ({ handle: () => of(body) });
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
});
