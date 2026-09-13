import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { IpdFinanceService } from './ipd-finance.service';
import { TransferBedDto } from './dto/transfer-bed.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('admissions')
export class IpdFinanceController {
  constructor(private readonly ipdFinance: IpdFinanceService) {}

  /**
   * Manually (re-)runs the nightly bed-day job for a given date — an
   * operational fallback if the cron missed a night. Defaults to today.
   * Declared before the `:id/...` routes so its static path is never
   * shadowed by the wildcard param.
   */
  @Post('bed-day-charges/run')
  @RequirePermission('Charge', 'create')
  async runBedDayJob(@Query('date') date?: string) {
    return this.ipdFinance.postBedDayCharges(date ? new Date(date) : new Date());
  }

  @Get(':id/financial-summary')
  @RequirePermission('Charge', 'read')
  async financialSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.ipdFinance.admissionFinancialSummary(id);
  }

  @Get(':id/location-history')
  @RequirePermission('Admission', 'read')
  async locationHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.ipdFinance.getLocationHistory(id);
  }

  // A dedicated permission rather than the broad Admission:update — moving a
  // patient's bed is routine ward-nursing work, not the same privilege level
  // as creating/deleting wards or resolving eligibility.
  @Post(':id/transfer')
  @RequirePermission('Admission', 'transfer')
  async transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferBedDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    return this.ipdFinance.transferBed({
      admissionId: id,
      toBedId: dto.toBedId,
      reason: dto.reason,
      movedById: user.id,
    });
  }
}
