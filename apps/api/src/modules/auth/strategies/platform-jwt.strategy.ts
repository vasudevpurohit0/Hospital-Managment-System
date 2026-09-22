import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PlatformPrismaService } from '../../../common/tenant/platform-prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { JWT_PLATFORM_SECRET } from '../../../common/config/jwt-secrets';
import { PLATFORM_TOKEN_COOKIE } from '../../../common/auth/auth-cookies.util';

function platformCookieExtractor(req: Request): string | null {
  return req?.cookies?.[PLATFORM_TOKEN_COOKIE] ?? null;
}

export interface PlatformJwtPayload {
  sub: string;
  email: string;
  type: 'platform';
}

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(private platformPrisma: PlatformPrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), platformCookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: JWT_PLATFORM_SECRET,
    });
  }

  async validate(payload: PlatformJwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'platform') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.platformPrisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Platform user inactive or missing');
    }

    return {
      id: user.id,
      identifier: user.email,
      roleId: '',
      roleName: 'SuperAdmin',
      type: 'platform',
      permissions: [],
    };
  }
}
