import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { TenantClientFactory } from '../tenant/tenant-client-factory';
import { PlatformPrismaService } from '../tenant/platform-prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

type DecodedToken =
  | { kind: 'hospital'; hospitalId: string; schemaName: string }
  | { kind: 'platform'; platformUserId: string };

/**
 * Runs before the guard chain (middleware, not a guard) so it can wrap the
 * ENTIRE rest of the request -- guards, JwtStrategy's own DB reload,
 * interceptors, the controller handler -- in one AsyncLocalStorage.run()
 * call. A guard's canActivate() can't do that: it returns before downstream
 * execution happens.
 *
 * This does its own lightweight JWT decode (not full Passport validation --
 * that still happens normally afterward in JwtAuthGuard). A missing or
 * undecodable token just calls next() with no tenant context set: @Public()
 * routes never touch PrismaService, and protected routes still get a clean
 * 401 from the real Passport guard right after this middleware runs.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantClients: TenantClientFactory,
    private readonly platformPrisma: PlatformPrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) return next();

      const decoded = this.decodeToken(token);
      if (!decoded) return next(); // invalid/expired -- let JwtAuthGuard produce the real 401

      let hospitalId: string;
      let schemaName: string;

      if (decoded.kind === 'platform') {
        const headerHospitalId = req.headers['x-hospital-id'] as string | undefined;
        if (!headerHospitalId) return next(); // platform-only endpoint, no tenant needed

        const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: headerHospitalId } });
        if (!hospital || hospital.status !== 'ACTIVE') {
          throw new ForbiddenException('Invalid or inactive hospital');
        }
        hospitalId = hospital.id;
        schemaName = hospital.schemaName;

        // Fire-and-forget: a Super Admin can see PHI across every hospital,
        // so every request they make against one is logged. Never awaited
        // and never allowed to fail the real request -- an audit-log write
        // failure must not become a reason a legitimate request breaks.
        this.platformPrisma.platformAuditLog
          .create({
            data: {
              platformUserId: decoded.platformUserId,
              hospitalId: hospital.id,
              action: req.method,
              path: req.originalUrl || req.url,
              method: req.method,
            },
          })
          .catch(() => undefined);
      } else {
        hospitalId = decoded.hospitalId;
        schemaName = decoded.schemaName;
      }

      const prismaClient = await this.tenantClients.getClient(schemaName);
      tenantStorage.run({ hospitalId, schemaName, prismaClient }, () => next());
    } catch (err) {
      next(err);
    }
  }

  private decodeToken(token: string): DecodedToken | null {
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345') as Record<
        string,
        unknown
      >;
      if (payload?.type === 'access' && typeof payload.hospitalId === 'string' && typeof payload.schemaName === 'string') {
        return { kind: 'hospital', hospitalId: payload.hospitalId, schemaName: payload.schemaName };
      }
      return null;
    } catch {
      // Not a valid hospital-staff token -- fall through and try the platform secret.
    }

    try {
      const payload = jwt.verify(
        token,
        process.env.JWT_PLATFORM_SECRET || 'dev_jwt_platform_secret_key_platform',
      ) as Record<string, unknown>;
      if (payload?.type === 'platform' && typeof payload.sub === 'string') {
        return { kind: 'platform', platformUserId: payload.sub };
      }
      return null;
    } catch {
      return null;
    }
  }
}
