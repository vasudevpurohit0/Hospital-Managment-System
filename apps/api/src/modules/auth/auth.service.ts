import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(identifier: string, pass: string) {
    if (!identifier || typeof identifier !== 'string' || !pass || typeof pass !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }

    let user;
    try {
      user = await this.prisma.user.findUnique({
        where: { identifier: identifier.trim() },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.error(`Database error during validateUser lookup for "${identifier}":`, err);
      throw new ServiceUnavailableException('Database service is currently unavailable.');
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials or account inactive');
    }

    if (!user.active) {
      throw new UnauthorizedException('User account inactive');
    }

    if (!user.passwordHash || typeof user.passwordHash !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(pass, user.passwordHash);
    } catch (err: unknown) {
      this.logger.error(`Password comparison error for user "${identifier}":`, err);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.identifier, loginDto.password);
    const roleName = user.role?.name || 'Doctor';

    const payload: JwtPayload = {
      sub: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName,
      type: 'access',
    };

    const refreshPayload = {
      sub: user.id,
      identifier: user.identifier,
      type: 'refresh',
    };

    try {
      const accessToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
        expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
      });

      const refreshToken = this.jwtService.sign(refreshPayload, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_67890',
        expiresIn: '7d',
      });

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          identifier: user.identifier,
          role: roleName,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`JWT signing error during login for "${user.identifier}":`, err);
      throw new InternalServerErrorException('Failed to generate authentication tokens.');
    }
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    try {
      const payload = this.jwtService.verify(refreshTokenDto.refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_67890',
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token type');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: true },
      });

      if (!user || !user.active) {
        throw new UnauthorizedException('User no longer active');
      }

      const roleName = user.role?.name || 'Doctor';

      const accessPayload: JwtPayload = {
        sub: user.id,
        identifier: user.identifier,
        roleId: user.roleId,
        roleName,
        type: 'access',
      };

      const newAccessToken = this.jwtService.sign(accessPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
        expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
      });

      return {
        accessToken: newAccessToken,
      };
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
  }
}
