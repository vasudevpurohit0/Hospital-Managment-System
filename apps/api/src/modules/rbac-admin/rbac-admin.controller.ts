import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RbacAdminService } from './rbac-admin.service';
import { GrantPermissionDto } from './dto/rbac-admin.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('rbac')
export class RbacAdminController {
  constructor(private readonly rbac: RbacAdminService) {}

  @Get('roles')
  @RequirePermission('RbacConfig', 'read')
  async listRoles() {
    return this.rbac.listRoles();
  }

  @Get('roles/:id/permissions')
  @RequirePermission('RbacConfig', 'read')
  async listPermissionsForRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.listPermissionsForRole(id);
  }

  @Get('known-resource-actions')
  @RequirePermission('RbacConfig', 'read')
  async listKnownResourceActions() {
    return this.rbac.listKnownResourceActions();
  }

  @Post('permissions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('RbacConfig', 'update')
  async grant(@Body() dto: GrantPermissionDto) {
    return this.rbac.grantPermission(dto);
  }

  @Delete('permissions/:id')
  @RequirePermission('RbacConfig', 'update')
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.revokePermission(id);
  }
}
