import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { HospitalAdminsService } from './hospital-admins.service';
import { CreateHospitalAdminDto } from './dto/create-hospital-admin.dto';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Routes span two URL shapes (`platform/hospital-admins` for the flat
 * cross-hospital roster, `platform/hospitals/:id/admins` for actions scoped
 * to one hospital), so this controller carries no path prefix of its own and
 * spells each route out in full, rather than being split across two
 * controllers for what is one feature.
 */
@Controller('platform')
@UseGuards(PlatformOnlyGuard)
export class HospitalAdminsController {
  constructor(private readonly hospitalAdmins: HospitalAdminsService) {}

  @Get('hospital-admins')
  async list() {
    return this.hospitalAdmins.list();
  }

  @Post('hospitals/:id/admins')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateHospitalAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalAdmins.create(id, dto, user.id);
  }

  @Patch('hospitals/:id/admins/:userId/active')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body('active') active: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalAdmins.setActive(id, userId, active, user.id);
  }
}
