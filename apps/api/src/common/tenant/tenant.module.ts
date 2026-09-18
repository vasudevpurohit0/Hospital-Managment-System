import { Global, Module } from '@nestjs/common';
import { TenantClientFactory } from './tenant-client-factory';
import { PlatformPrismaService } from './platform-prisma.service';
import { LoginDirectoryService } from './login-directory.service';
import { TenantUserProvisioningService } from './tenant-user-provisioning.service';

@Global()
@Module({
  providers: [TenantClientFactory, PlatformPrismaService, LoginDirectoryService, TenantUserProvisioningService],
  exports: [TenantClientFactory, PlatformPrismaService, LoginDirectoryService, TenantUserProvisioningService],
})
export class TenantModule {}
