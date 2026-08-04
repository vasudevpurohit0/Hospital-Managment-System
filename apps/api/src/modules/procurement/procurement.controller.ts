import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { ApproveRequisitionDto } from './dto/approve-requisition.dto';
import { CreatePODto } from './dto/create-po.dto';
import { CreateGRNDto } from './dto/create-grn.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Post('requisitions')
  @RequirePermission('Inventory', 'create')
  async createRequisition(@Body() dto: CreateRequisitionDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.procurementService.createRequisition(dto, userId);
  }

  @Get('requisitions')
  @RequirePermission('Employee', 'read')
  async findAllRequisitions() {
    return this.procurementService.findAllRequisitions();
  }

  @Post('requisitions/:id/approve')
  @RequirePermission('Inventory', 'approve')
  async approveRequisition(
    @Param('id') id: string,
    @Body() dto: ApproveRequisitionDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.procurementService.approveRequisition(id, dto, userId);
  }

  @Post('purchase-orders')
  @RequirePermission('Inventory', 'create')
  async createPurchaseOrder(@Body() dto: CreatePODto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.procurementService.createPurchaseOrder(dto, userId);
  }

  @Get('purchase-orders')
  @RequirePermission('Employee', 'read')
  async findAllPurchaseOrders() {
    return this.procurementService.findAllPurchaseOrders();
  }

  @Post('goods-receipt-notes')
  @RequirePermission('Inventory', 'create')
  async createGRN(@Body() dto: CreateGRNDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.procurementService.createGRN(dto, userId);
  }

  @Post('transfers')
  @RequirePermission('Inventory', 'create')
  async createStoreTransfer(@Body() dto: CreateTransferDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.procurementService.createStoreTransfer(dto, userId);
  }
}
