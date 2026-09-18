import { Global, Module } from '@nestjs/common';
import { TenantClientFactory } from './tenant-client-factory';
import { PlatformPrismaService } from './platform-prisma.service';

@Global()
@Module({
  providers: [TenantClientFactory, PlatformPrismaService],
  exports: [TenantClientFactory, PlatformPrismaService],
})
export class TenantModule {}
