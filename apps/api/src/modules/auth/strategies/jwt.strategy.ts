import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  identifier: string;
  roleId: string;
  roleName: string;
  type?: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

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
      permissions: user.role.permissions.map((p: any) => ({
        resource: p.resource,
        action: p.action,
      })),
    };
  }
}
