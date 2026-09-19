import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
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
    };
  }
}
