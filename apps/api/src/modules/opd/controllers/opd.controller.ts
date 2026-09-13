import { BadRequestException, Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import { OpdService } from '../services/opd.service';
import { CreateOpdVisitDto } from '../dto/create-opd-visit.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';

@Controller('opd-visits')
export class OpdController {
  constructor(private readonly opdService: OpdService) {}

  @Post()
  @RequirePermission('Employee', 'read')
  async createOpdVisit(@Body() createOpdVisitDto: CreateOpdVisitDto) {
    return this.opdService.createOpdVisit(createOpdVisitDto);
  }

  @Get('queue')
  @RequirePermission('Employee', 'read')
  async getQueue(@Query('departmentId') departmentId?: string) {
    // Found during the P8 sweep: an absent departmentId reached
    // Prisma as `where: { id: undefined }`, which throws a raw
    // PrismaClientValidationError the global filter then flattens into an
    // opaque 500. A missing required filter is a client error, not a
    // server fault.
    if (!departmentId) {
      throw new BadRequestException('departmentId query parameter is required');
    }
    return this.opdService.getQueue(departmentId);
  }

  @Post(':id/call')
  @RequirePermission('Employee', 'read')
  async callToken(@Param('id') id: string) {
    return this.opdService.callToken(id);
  }

  @Post(':id/close')
  @RequirePermission('Employee', 'read')
  async closeOpdVisit(@Param('id') id: string) {
    return this.opdService.closeOpdVisit(id);
  }
}
