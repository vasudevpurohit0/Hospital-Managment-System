import { BadRequestException, Controller, Post, Get, Patch, Body, Query, Param } from '@nestjs/common';
import { OpdService } from '../services/opd.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';
import { TransferOpdVisitDto } from '../dto/transfer-opd-visit.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('opd-visits')
export class OpdController {
  constructor(private readonly opdService: OpdService) {}

  @Post()
  @RequirePermission('OPDVisit', 'create')
  async createOpdVisit(@Body() createOpdVisitDto: CreateOpdVisitDto) {
    return this.opdService.createOpdVisit(createOpdVisitDto);
  }

  @Get('queue')
  @RequirePermission('Employee', 'read')
  async getQueue(@Query('departmentId') departmentId?: string, @Query('doctorId') doctorId?: string) {
    // Found during the P8 sweep: an absent departmentId reached
    // Prisma as `where: { id: undefined }`, which throws a raw
    // PrismaClientValidationError the global filter then flattens into an
    // opaque 500. A missing required filter is a client error, not a
    // server fault.
    if (!departmentId) {
      throw new BadRequestException('departmentId query parameter is required');
    }
    return this.opdService.getQueue(departmentId, doctorId);
  }

  /** A doctor's own active (waiting/called/in-consultation) queue -- doctorId always comes from the JWT, never the client, for a Doctor caller. */
  @Get('my-queue')
  @RequirePermission('OPDVisit', 'read')
  async getMyQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.opdService.getMyQueue(user.id);
  }

  /** Safely claims the first eligible waiting patient in the caller's own queue. */
  @Post('call-next')
  @RequirePermission('OPDVisit', 'call')
  async callNext(@CurrentUser() user: AuthenticatedUser) {
    return this.opdService.callNext(user.id);
  }

  @Post(':id/call')
  @RequirePermission('OPDVisit', 'call')
  async callToken(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.callToken(id, { id: user.id, roleName: user.roleName });
  }

  @Patch(':id/start-consultation')
  @RequirePermission('OPDVisit', 'update')
  async startConsultation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.startConsultation(id, { id: user.id, roleName: user.roleName });
  }

  @Patch(':id/complete')
  @RequirePermission('OPDVisit', 'update')
  async completeConsultation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.completeConsultation(id, { id: user.id, roleName: user.roleName });
  }

  @Patch(':id/no-show')
  @RequirePermission('OPDVisit', 'update')
  async markNoShow(@Param('id') id: string, @Body('reason') reason: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.markNoShow(id, { id: user.id, roleName: user.roleName }, reason);
  }

  @Patch(':id/skip')
  @RequirePermission('OPDVisit', 'update')
  async skip(@Param('id') id: string, @Body('reason') reason: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.skip(id, { id: user.id, roleName: user.roleName }, reason);
  }

  @Patch(':id/cancel')
  @RequirePermission('OPDVisit', 'cancel')
  async cancel(@Param('id') id: string, @Body('reason') reason: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.opdService.cancel(id, { id: user.id, roleName: user.roleName }, reason);
  }

  @Patch(':id/transfer')
  @RequirePermission('OPDVisit', 'transfer')
  async transfer(
    @Param('id') id: string,
    @Body() dto: TransferOpdVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opdService.transfer(id, dto.doctorId, { id: user.id, roleName: user.roleName }, dto.reason);
  }

  @Get('my-patients')
  @RequirePermission('OPDVisit', 'read')
  async getMyPatients(@CurrentUser('id') doctorId: string) {
    return this.opdService.getMyPatients(doctorId);
  }

  @Post(':id/close')
  @RequirePermission('OPDVisit', 'update')
  async closeOpdVisit(@Param('id') id: string) {
    return this.opdService.closeOpdVisit(id);
  }
}
