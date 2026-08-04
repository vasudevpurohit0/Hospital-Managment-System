import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ExpiryScannerService } from './services/expiry-scanner.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { DisposeBatchDto } from './dto/dispose-batch.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly expiryScannerService: ExpiryScannerService,
  ) {}

  @Get('medicines')
  @RequirePermission('Employee', 'read')
  async findAllMedicines() {
    return this.inventoryService.findAllMedicines();
  }

  @Post('medicines')
  @RequirePermission('Inventory', 'create')
  async createMedicine(@Body() dto: CreateMedicineDto) {
    return this.inventoryService.createMedicine(dto);
  }

  @Post('batches')
  @RequirePermission('Inventory', 'create')
  async createBatch(@Body() dto: CreateBatchDto) {
    return this.inventoryService.createBatch(dto);
  }

  @Get('low-stock')
  @RequirePermission('Employee', 'read')
  async getLowStockAlerts() {
    return this.inventoryService.getLowStockAlerts();
  }

  @Get('stock-locations')
  @RequirePermission('Employee', 'read')
  async getPharmacyStock() {
    return this.inventoryService.getPharmacyStock();
  }

  @Post('scan-expiry')
  @RequirePermission('Inventory', 'create')
  async triggerExpiryScan() {
    return this.expiryScannerService.runDailyScan();
  }

  @Get('expiring')
  @RequirePermission('Employee', 'read')
  async getExpiringBatches(@Query('within') within?: string) {
    const days = within ? parseInt(within, 10) : 90;
    return this.inventoryService.getExpiringBatches(days);
  }

  @Post('batches/:id/quarantine')
  @RequirePermission('Inventory', 'create')
  async quarantineBatch(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.inventoryService.quarantineBatch(id, reason);
  }

  @Post('batches/:id/dispose')
  @RequirePermission('Inventory', 'create')
  async disposeBatch(@Param('id') id: string, @Body() dto: DisposeBatchDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.inventoryService.disposeBatch(id, dto, userId);
  }
}
