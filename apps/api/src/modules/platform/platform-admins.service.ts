import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { recordPlatformAuditLog } from '../../common/tenant/platform-audit.util';
import { CreatePlatformAdminDto } from './dto/create-platform-admin.dto';

@Injectable()
export class PlatformAdminsService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async list() {
    return this.platformPrisma.platformUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, active: true, createdAt: true },
    });
  }

  async create(dto: CreatePlatformAdminDto, callerId: string) {
    const existing = await this.platformPrisma.platformUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`A platform admin with email "${dto.email}" already exists.`);
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.platformPrisma.platformUser.create({
      data: { email: dto.email, name: dto.name, passwordHash },
    });
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId: callerId,
      action: 'platform_admin.create',
      resource: 'PlatformUser',
      metadata: { email: user.email },
    });
    return { id: user.id, email: user.email, name: user.name, active: user.active, createdAt: user.createdAt };
  }

  /**
   * Deactivates (never deletes -- keeps the row for any future audit trail
   * that references it) a platform admin. A caller can never deactivate
   * their own account: without this guard, the very last active Super Admin
   * could lock the platform's control plane with no way back in.
   */
  async setActive(id: string, active: boolean, callerId: string) {
    if (id === callerId && !active) {
      throw new BadRequestException('You cannot deactivate your own platform admin account.');
    }
    const existing = await this.platformPrisma.platformUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Platform admin not found: ${id}`);

    if (!active) {
      const activeCount = await this.platformPrisma.platformUser.count({ where: { active: true } });
      if (activeCount <= 1) {
        throw new BadRequestException('Cannot deactivate the only remaining active platform admin.');
      }
    }

    const user = await this.platformPrisma.platformUser.update({ where: { id }, data: { active } });
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId: callerId,
      action: active ? 'platform_admin.activate' : 'platform_admin.deactivate',
      resource: 'PlatformUser',
      metadata: { email: user.email },
    });
    return { id: user.id, email: user.email, name: user.name, active: user.active };
  }
}
