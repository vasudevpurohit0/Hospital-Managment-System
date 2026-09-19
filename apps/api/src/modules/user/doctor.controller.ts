import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, BadRequestException } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  @RequirePermission('Doctor', 'read')
  async findAll() {
    return this.doctorService.findAllDoctors();
  }

  /**
   * Backs the OPD registration doctor picker -- active, Doctor role, has a
   * profile, belongs to this department. With `autoAssign=true`, returns
   * just the single least-busy eligible doctor instead of the full list --
   * a convenience, never the default.
   */
  @Get('eligible')
  @RequirePermission('Doctor', 'read')
  async findEligible(@Query('departmentId') departmentId?: string, @Query('autoAssign') autoAssign?: string) {
    if (!departmentId) {
      throw new BadRequestException('departmentId query parameter is required');
    }
    if (autoAssign === 'true') {
      const doctor = await this.doctorService.findLeastBusyEligibleDoctor(departmentId);
      return doctor ? [doctor] : [];
    }
    return this.doctorService.findEligibleDoctors(departmentId);
  }

  /** Admin roster: includes deactivated doctors too, so they can be reactivated. */
  @Get('admin')
  @RequirePermission('Doctor', 'update')
  async findAllForAdmin() {
    return this.doctorService.findAllDoctorsForAdmin();
  }

  @Post()
  @RequirePermission('Doctor', 'create')
  async createDoctor(@Body() body: CreateDoctorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.doctorService.createDoctor(body, { id: user.id, roleName: user.roleName });
  }

  @Patch(':id')
  @RequirePermission('Doctor', 'update')
  async updateDoctor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDoctorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.doctorService.updateDoctor(id, dto, { id: user.id, roleName: user.roleName });
  }

  @Patch(':id/active')
  @RequirePermission('Doctor', 'delete')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('active') active: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.doctorService.setActive(id, active, { id: user.id, roleName: user.roleName });
  }

  @Post(':id/reset-password')
  @RequirePermission('Doctor', 'update')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.doctorService.resetPassword(id, { id: user.id, roleName: user.roleName }, reason);
  }

  @Patch(':id/lock')
  @RequirePermission('Doctor', 'update')
  async setLocked(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('locked') locked: boolean,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.doctorService.setLocked(id, locked, { id: user.id, roleName: user.roleName }, reason);
  }

  @Post(':id/resend-activation')
  @RequirePermission('Doctor', 'update')
  async resendActivation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.doctorService.resendActivation(id, { id: user.id, roleName: user.roleName });
  }
}
