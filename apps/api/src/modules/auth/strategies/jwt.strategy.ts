import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthenticatedUser, ImpersonationClaims } from '../../../common/decorators/current-user.decorator';
import { JWT_ACCESS_SECRET } from '../../../common/config/jwt-secrets';
import { ACCESS_TOKEN_COOKIE } from '../../../common/auth/auth-cookies.util';

/**
 * Header first (unchanged -- every existing test/consumer/impersonation
 * flow keeps working exactly as before), falling back to the httpOnly
 * cookie AuthController now also sets so a browser session no longer needs
 * to keep a JS-readable copy of the token anywhere to stay authenticated.
 */
function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
}

export interface JwtPayload {
  sub: string;
  identifier: string;
  roleId: string;
  roleName: string;
  /** Which hospital's schema this user belongs to -- always present on a hospital-staff token. */
  hospitalId: string;
  /**
   * Denormalized alongside hospitalId so the tenant schema can be resolved
   * straight from the token, with no platform-DB lookup needed before the
   * tenant context can be set (avoids a chicken-and-egg problem: the
   * Users table this token's `sub` refers to only exists once the right
   * schema is already selected).
   */
  schemaName: string;
  /** Compared against the live User row on every request; a mismatch means this token was issued before a password change/reset/lock/deactivation and must be rejected even though it hasn't expired yet. */
  tokenVersion: number;
  type?: 'access' | 'refresh';
  /** Double-submit CSRF nonce (2026-09-22 audit) -- verified against the X-CSRF-Token header in security.middleware.ts for cookie-authenticated mutating requests. Not used by JwtStrategy itself; declared here so auth.service.ts can type-check setting it. */
  csrf?: string;
  /**
   * Present only on a token minted by AccountLifecycleService.impersonate().
   * Every other field above (sub, roleId, roleName, tokenVersion, ...) is
   * already the TARGET user's own -- this claim carries nothing that affects
   * authorization, only who to attribute/restore. Locking, deactivating, or
   * resetting the target's password bumps their tokenVersion exactly like it
   * does for the target's own real sessions, which is what makes those
   * actions kill an in-progress impersonation session too, automatically.
   */
  impersonation?: ImpersonationClaims;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // TenantResolutionMiddleware has already set the AsyncLocalStorage tenant
    // context for this request (from this same payload's hospitalId/
    // schemaName), so this.prisma is already routed to the right schema.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User account inactive or missing');
    }

    if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Session invalidated -- please log in again.');
    }

    return {
      id: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName: user.role.name,
      hospitalId: payload.hospitalId,
      type: 'hospital',
      mustChangePassword: user.mustChangePassword,
      permissions: user.role.permissions.map((p: any) => ({
        resource: p.resource,
        action: p.action,
      })),
      impersonation: payload.impersonation,
    };
  }
}
