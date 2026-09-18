import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '.prisma/platform-client';

/**
 * Fixed connection to the control-plane (`public` schema) database --
 * Hospital / PlatformUser / PlatformAuditLog. Unlike PrismaService, this is
 * never tenant-routed: there is exactly one platform database, always.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformPrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to platform (control-plane) database');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Platform database connection deferred/unavailable: ${message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}
