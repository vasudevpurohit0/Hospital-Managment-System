import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Req,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { InventoryService } from './inventory.service';
import { ExpiryScannerService } from './services/expiry-scanner.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { DisposeBatchDto } from './dto/dispose-batch.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  generateMedicineTemplateXlsx,
  generateMedicineErrorReportXlsx,
  RejectedImportRow,
} from './excel/medicine-excel.util';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly expiryScannerService: ExpiryScannerService,
  ) {}

  @Get('medicines/template')
  @RequirePermission('Medicine', 'create')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await generateMedicineTemplateXlsx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="medicine_import_template.xlsx"',
    );
    res.send(buffer);
  }

  @Post('medicines/import/validate')
  @RequirePermission('Medicine', 'create')
  async validateImport(@Body() body: { fileBase64: string }) {
    if (!body?.fileBase64) {
      throw new BadRequestException('No file data provided.');
    }
    const cleanBase64 = body.fileBase64.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    return this.inventoryService.validateMedicineImport(buffer);
  }

  @Post('medicines/import/confirm')
  @RequirePermission('Medicine', 'create')
  async confirmImport(@Body() body: { items: CreateMedicineDto[] }) {
    if (!body?.items || !Array.isArray(body.items)) {
      throw new BadRequestException('Invalid medicine items payload.');
    }
    return this.inventoryService.confirmMedicineImport(body.items);
  }

  @Post('medicines/import/error-report')
  @RequirePermission('Medicine', 'create')
  async downloadErrorReport(
    @Body() body: { rejectedItems: RejectedImportRow[] },
    @Res() res: Response,
  ) {
    if (!body?.rejectedItems || !Array.isArray(body.rejectedItems)) {
      throw new BadRequestException('No error items provided.');
    }
    const buffer = await generateMedicineErrorReportXlsx(body.rejectedItems);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="medicine_import_errors.xlsx"',
    );
    res.send(buffer);
  }

  @Get('medicines')
  @RequirePermission('MedicineBatch', 'read')
  async findAllMedicines() {
    return this.inventoryService.findAllMedicines();
  }

  @Post('medicines')
  @RequirePermission('Medicine', 'create')
  async createMedicine(@Body() dto: CreateMedicineDto) {
    return this.inventoryService.createMedicine(dto);
  }

  @Post('batches')
  @RequirePermission('MedicineBatch', 'create')
  async createBatch(@Body() dto: CreateBatchDto) {
    return this.inventoryService.createBatch(dto);
  }

  @Get('low-stock')
  @RequirePermission('MedicineBatch', 'read')
  async getLowStockAlerts() {
    return this.inventoryService.getLowStockAlerts();
  }

  @Get('stock-locations')
  @RequirePermission('MedicineBatch', 'read')
  async getPharmacyStock() {
    return this.inventoryService.getPharmacyStock();
  }

  @Post('scan-expiry')
  @RequirePermission('MedicineBatch', 'update')
  async triggerExpiryScan() {
    return this.expiryScannerService.runDailyScan();
  }

  @Get('expiring')
  @RequirePermission('MedicineBatch', 'read')
  async getExpiringBatches(@Query('within') within?: string) {
    const days = within ? parseInt(within, 10) : 90;
    return this.inventoryService.getExpiringBatches(days);
  }

  @Post('batches/:id/quarantine')
  @RequirePermission('MedicineBatch', 'update')
  async quarantineBatch(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.inventoryService.quarantineBatch(id, reason);
  }

  @Post('batches/:id/dispose')
  @RequirePermission('MedicineBatch', 'update')
  async disposeBatch(@Param('id') id: string, @Body() dto: DisposeBatchDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) throw new UnauthorizedException('User context missing');
    return this.inventoryService.disposeBatch(id, dto, userId);
  }
}
