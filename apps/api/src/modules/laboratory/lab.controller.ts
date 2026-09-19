import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { LabOrderStatus } from '@prisma/client';
import { LabService } from './lab.service';
import { CollectSampleDto, CreateLabOrderDto, EnterResultsDto, VerifyLabOrderDto } from './dto/lab.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DocumentRenderService } from '../../common/rendering/document-render.service';
import { renderLabReportHtml } from '../../common/rendering/pdf-templates';

@Controller('lab')
export class LabController {
  constructor(
    private readonly lab: LabService,
    private readonly documentRender: DocumentRenderService,
  ) {}

  @Get('tests')
  @RequirePermission('LabTest', 'read')
  async listTests(@Query('discipline') discipline?: string) {
    return this.lab.listTests(discipline);
  }

  @Get('tests/:id')
  @RequirePermission('LabTest', 'read')
  async getTest(@Param('id', ParseUUIDPipe) id: string) {
    return this.lab.getTest(id);
  }

  @Get('queue')
  @RequirePermission('LabOrder', 'read')
  async queue(@Query('status') status?: LabOrderStatus, @Query('visitId') visitId?: string) {
    return this.lab.listQueue(status, visitId);
  }

  @Get('orders/:id')
  @RequirePermission('LabOrder', 'read')
  async getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.lab.getOrder(id);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('LabOrder', 'create')
  async orderTests(@Body() dto: CreateLabOrderDto, @CurrentUser() user?: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    return this.lab.orderTests(dto, user.id);
  }

  @Post('orders/:id/collect')
  @RequirePermission('LabSample', 'create')
  async collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectSampleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    return this.lab.collectSample(id, dto.specimenType, user.id);
  }

  @Post('results')
  @RequirePermission('LabResult', 'create')
  async enterResults(@Body() dto: EnterResultsDto, @CurrentUser() user?: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    return this.lab.enterResults(dto, user.id);
  }

  /**
   * A technician's entry is never the final report: this endpoint requires
   * LabResult:verify, which only Pathologist holds — LabTechnician cannot
   * reach it regardless of what the request body contains.
   */
  @Post('orders/:id/verify')
  @RequirePermission('LabResult', 'verify')
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyLabOrderDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user?.id) throw new UnauthorizedException('User context missing');
    return this.lab.verifyOrder(id, dto.pathologistRemarks, user.id);
  }

  @Get('orders/:id/report')
  @RequirePermission('LabReport', 'read')
  async getReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.lab.getReport(id);
  }

  @Get('orders/:id/report/pdf')
  @RequirePermission('LabReport', 'read')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Header('Content-Type', 'application/pdf')
  async getReportPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const report = await this.lab.getReport(id);
    const branding = await this.documentRender.getBranding();
    const pdf = await this.documentRender.renderPdf(renderLabReportHtml(branding, report));
    const filename = (report.labNumber ?? id).replace(/\//g, '-');
    res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
    res.send(pdf);
  }
}
