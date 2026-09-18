import { Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformJwtPayload } from './strategies/platform-jwt.strategy';

/**
 * Auth for the global Super Admin (PlatformUser), entirely separate from
 * hospital-staff login: no hospital selection, no tenant schema involved --
 * PlatformUser always lives in the public control-plane schema.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private platformPrisma: PlatformPrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: PlatformLoginDto) {
    const user = await this.platformPrisma.platformUser.findUnique({ where: { email: dto.email.trim() } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: PlatformJwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'platform',
    };

    try {
      const accessToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_PLATFORM_SECRET || 'dev_jwt_platform_secret_key_platform',
        expiresIn: (process.env.JWT_PLATFORM_EXPIRES_IN as any) || '8h',
      });

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`JWT signing error during platform login for "${user.email}":`, err);
      throw new InternalServerErrorException('Failed to generate authentication tokens.');
    }
  }
}
