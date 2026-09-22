import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CreateDefaultRolesDto } from './dto/create-default-roles.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { setAccessTokenCookie } from '../../common/auth/auth-cookies.util';

/**
 * Generic staff account management for every seeded role except Doctor
 * (which keeps its own dedicated DoctorController -- see staff-role.const.ts
 * for why). Route shape mirrors doctor.controller.ts one-to-one.
 */
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  /**
   * "Create Roles Automatically" -- declared before the `:id` routes below so
   * the literal `default-roles` path can never be captured as an id param.
   * Gated on Staff:create (Administrator-only in practice): Doctors, Nurses
   * and every other operational role get a 403 here, and the platform Super
   * Admin passes via the standard type-based bypass.
   */
  @Get('default-roles')
  @RequirePermission('Staff', 'create')
  async getDefaultRoles() {
    return this.staffService.getDefaultRolesStatus();
  }

  @Post('default-roles')
  @RequirePermission('Staff', 'create')
  async createDefaultRoles(@Body() body: CreateDefaultRolesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.staffService.createDefaultRoleAccounts(body, {
      id: user.id,
      roleName: user.roleName,
      type: user.type,
    });
  }

  @Get()
  @RequirePermission('Staff', 'read')
  async findAll(
    @Query('role') role?: string,
    @Query('department') department?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.staffService.findAllForAdmin({
      role,
      department,
      search,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @RequirePermission('Staff', 'read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.staffService.findOne(id);
  }

  @Post()
  @RequirePermission('Staff', 'create')
  async createStaff(@Body() body: CreateStaffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.staffService.createStaff(body, { id: user.id, roleName: user.roleName, type: user.type });
  }

  @Patch(':id')
  @RequirePermission('Staff', 'update')
  async updateStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.updateStaff(id, dto, { id: user.id, roleName: user.roleName, type: user.type });
  }

  @Patch(':id/active')
  @RequirePermission('Staff', 'delete')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('active') active: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.setActive(id, active, { id: user.id, roleName: user.roleName, type: user.type });
  }

  @Post(':id/reset-password')
  @RequirePermission('Staff', 'update')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.resetPassword(id, { id: user.id, roleName: user.roleName, type: user.type }, reason);
  }

  @Patch(':id/lock')
  @RequirePermission('Staff', 'update')
  async setLocked(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('locked') locked: boolean,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.staffService.setLocked(id, locked, { id: user.id, roleName: user.roleName, type: user.type }, reason);
  }

  @Post(':id/resend-activation')
  @RequirePermission('Staff', 'update')
  async resendActivation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.staffService.resendActivation(id, { id: user.id, roleName: user.roleName, type: user.type });
  }

  /** Starts a secure impersonation session as this staff member -- see AccountLifecycleService.impersonate() for every server-side eligibility rule enforced. */
  @Post(':id/impersonate')
  @RequirePermission('Staff', 'impersonate')
  async impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.staffService.impersonate(
      id,
      {
        id: user.id,
        roleName: user.roleName,
        type: user.type,
        identifier: user.identifier,
        isImpersonating: !!user.impersonation,
        impersonation: user.impersonation,
      },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    // Keeps a cookie-based session's ambient credential in sync with the
    // impersonated identity, exactly like the JSON body's accessToken
    // already is -- otherwise a stale cookie from before impersonation
    // would keep authenticating as the original admin on any request that
    // happened to rely on the cookie instead of the (unaffected) header.
    setAccessTokenCookie(res, result.accessToken);
    return result;
  }
}
