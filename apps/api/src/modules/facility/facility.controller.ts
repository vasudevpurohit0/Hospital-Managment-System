import { Controller, Get, Post, Put, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { FacilityEligibilityService } from './facility.service';
import { CreateFacilityRuleDto } from './dto/create-facility-rule.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('facility-rules')
@UseGuards(JwtAuthGuard)
export class FacilityController {
  constructor(private readonly service: FacilityEligibilityService) {}

  @Get()
  @RequirePermission('FacilityEligibilityRule', 'read')
  async findAll() {
    return this.service.findAll();
  }

  @Post()
  @RequirePermission('FacilityEligibilityRule', 'create')
  async createRule(@Body() dto: CreateFacilityRuleDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.create(dto, user?.id);
  }

  @Put(':id')
  @RequirePermission('FacilityEligibilityRule', 'update')
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFacilityRuleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user?.id);
  }

  @Get('resolve')
  @RequirePermission('Employee', 'read')
  async resolveRule(@Query('employeeId') employeeId: string) {
    return this.service.resolve(employeeId);
  }
}
