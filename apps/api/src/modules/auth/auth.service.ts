import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(identifier: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { identifier },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials or account inactive');
    }

    if (!user.active) {
      throw new UnauthorizedException('User account inactive');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.identifier, loginDto.password);

    const payload: JwtPayload = {
      sub: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName: user.role.name,
      type: 'access',
    };

    const refreshPayload = {
      sub: user.id,
      identifier: user.identifier,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
      expiresIn: '15m',
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
        role: user.role.name,
      },
    };
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

      const accessPayload: JwtPayload = {
        sub: user.id,
        identifier: user.identifier,
        roleId: user.roleId,
        roleName: user.role.name,
        type: 'access',
      };

      const newAccessToken = this.jwtService.sign(accessPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
        expiresIn: '15m',
      });

      return {
        accessToken: newAccessToken,
      };
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
  }
}
