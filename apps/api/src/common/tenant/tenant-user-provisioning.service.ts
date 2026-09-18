import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { TenantClientFactory } from './tenant-client-factory';
import { LoginDirectoryService } from './login-directory.service';

/**
 * The one place a hospital-local Administrator account gets created from
 * outside that hospital's own tenant context (hospital onboarding, and the
 * Phase 6 cross-hospital admin roster) -- both call sites need the exact same
 * two things done in the exact same order: register the identifier in the
 * global directory FIRST (so a collision anywhere on the platform is caught
 * before a tenant user ever exists for it), then create the tenant user, and
 * roll the directory registration back if the tenant-side create fails so no
 * identifier is ever left registered with nothing behind it.
 */
@Injectable()
export class TenantUserProvisioningService {
  constructor(
    private readonly tenantClients: TenantClientFactory,
    private readonly loginDirectory: LoginDirectoryService,
  ) {}

  async provisionAdministrator(
    schemaName: string,
    hospitalId: string,
    identifier: string,
    password: string,
  ): Promise<{ id: string; identifier: string }> {
    await this.loginDirectory.register(identifier, hospitalId);

    try {
      const client = await this.tenantClients.getClient(schemaName);
      const adminRole = await client.role.findUniqueOrThrow({ where: { name: 'Administrator' } });
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await client.user.create({
        data: { identifier, passwordHash, roleId: adminRole.id, active: true },
      });
      return { id: user.id, identifier: user.identifier };
    } catch (err) {
      await this.loginDirectory.remove(identifier).catch(() => undefined);
      throw err;
    }
  }
}
