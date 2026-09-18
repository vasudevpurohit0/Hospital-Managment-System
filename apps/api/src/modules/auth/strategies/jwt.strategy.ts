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

    return {
      id: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName: user.role.name,
      hospitalId: payload.hospitalId,
      type: 'hospital',
      permissions: user.role.permissions.map((p: any) => ({
        resource: p.resource,
        action: p.action,
      })),
    };
  }
}
