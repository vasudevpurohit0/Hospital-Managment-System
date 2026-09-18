import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';

@Controller('platform/audit-log')
@UseGuards(PlatformOnlyGuard)
export class PlatformAuditLogController {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  @Get()
  async list() {
    const entries = await this.platformPrisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        platformUser: { select: { email: true, name: true } },
        hospital: { select: { name: true, slug: true } },
      },
    });
    return entries.map((e) => ({
      id: e.id,
      action: e.action,
      method: e.method,
      path: e.path,
      createdAt: e.createdAt,
      platformUserEmail: e.platformUser.email,
      hospitalName: e.hospital?.name ?? null,
      hospitalSlug: e.hospital?.slug ?? null,
    }));
  }
}
