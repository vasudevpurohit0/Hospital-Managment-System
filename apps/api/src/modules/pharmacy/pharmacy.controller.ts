import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { PharmacyService } from './pharmacy.service';
import { DispenseMedicineDto } from './dto/dispense-medicine.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('pharmacy')
@UseGuards(JwtAuthGuard)
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  @Get('queue')
  @RequirePermission('Employee', 'read')
  async getQueue() {
    return this.pharmacyService.getQueue();
  }

  @Get('prescriptions/:id/batches')
  @RequirePermission('Employee', 'read')
  async getBatchOptions(@Param('id') id: string) {
    return this.pharmacyService.getBatchOptions(id);
  }

  @Post('dispense')
  @RequirePermission('Pharmacy', 'dispense')
  async dispense(@Body() dto: DispenseMedicineDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    const userRole = req.user?.roleName || req.user?.role || 'Pharmacist';
    return this.pharmacyService.dispense(dto, userId, userRole);
  }
}
