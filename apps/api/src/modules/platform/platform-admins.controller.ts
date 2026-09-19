import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformAdminsService } from './platform-admins.service';
import { CreatePlatformAdminDto } from './dto/create-platform-admin.dto';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('platform/admins')
@UseGuards(PlatformOnlyGuard)
export class PlatformAdminsController {
  constructor(private readonly admins: PlatformAdminsService) {}

  @Get()
  async list() {
    return this.admins.list();
  }

  @Post()
  async create(@Body() dto: CreatePlatformAdminDto, @CurrentUser('id') callerId: string) {
    return this.admins.create(dto, callerId);
  }

  @Patch(':id/active')
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('active') active: boolean,
    @CurrentUser('id') callerId: string,
  ) {
    return this.admins.setActive(id, active, callerId);
  }
}
