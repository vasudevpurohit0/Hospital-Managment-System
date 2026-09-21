import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('transactions')
  @RequirePermission('Billing', 'read')
  async findAllTransactions() {
    return this.billingService.findAllTransactions();
  }

  @Get('receipts/:id')
  @RequirePermission('Billing', 'read')
  async getReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.getReceipt(id);
  }
}
