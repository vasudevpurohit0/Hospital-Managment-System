import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GrantPermissionDto } from './dto/rbac-admin.dto';

/**
 * Feature 18 (RBAC) has always had a real enforcement engine (RbacGuard +
 * prisma.permission) but no administrative surface — the only way to see or
 * change "who can do what" was to read/edit prisma/seed.ts and re-seed.
 *
 * This service reads and writes the exact same `Role`/`Permission` tables
 * RbacGuard already checks on every request. There is no second permission
 * system here: granting or revoking through this API takes effect on the
 * very next request, the same as a seeded grant.
 */
@Injectable()
export class RbacAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { _count: { select: { permissions: true, users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystemRole: r.isSystemRole,
      permissionCount: r._count.permissions,
      userCount: r._count.users,
    }));
  }

  async listPermissionsForRole(roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException(`Role not found: ${roleId}`);
    return this.prisma.permission.findMany({
      where: { roleId },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  /**
   * Every distinct resource/action pair granted to any role today — used to
   * populate a picker so an administrator selects a real, already-meaningful
   * permission rather than free-typing a resource name that no @RequirePermission
   * decorator in the codebase actually checks for (a silent dead grant).
   */
  async listKnownResourceActions() {
    const rows = await this.prisma.permission.findMany({
      distinct: ['resource', 'action'],
      select: { resource: true, action: true },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    return rows;
  }

  async grantPermission(dto: GrantPermissionDto) {
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundException(`Role not found: ${dto.roleId}`);
    if (dto.resource === '*' || dto.action === '*') {
      throw new BadRequestException(
        'The universal wildcard (*:*) is reserved for SuperAdmin and cannot be granted here.',
      );
    }

    try {
      return await this.prisma.permission.create({
        data: { roleId: dto.roleId, resource: dto.resource, action: dto.action },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`${role.name} already has ${dto.resource}:${dto.action}.`);
      }
      throw e;
    }
  }

  async revokePermission(permissionId: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
      include: { role: true },
    });
    if (!permission) throw new NotFoundException(`Permission grant not found: ${permissionId}`);
    if (permission.role.name === 'SuperAdmin') {
      // SuperAdmin's guard bypass is role-name based (see RbacGuard), not
      // permission-row based, so this alone can't lock the role out — but
      // there is no legitimate reason to edit SuperAdmin's rows from here.
      throw new BadRequestException('SuperAdmin permissions are not managed through this screen.');
    }
    await this.prisma.permission.delete({ where: { id: permissionId } });
    return { revoked: true };
  }
}
