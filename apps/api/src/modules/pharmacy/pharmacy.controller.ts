import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { PharmacyService } from './pharmacy.service';
import { DispenseMedicineDto } from './dto/dispense-medicine.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('pharmacy')
@UseGuards(JwtAuthGuard)
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  @Get('queue')
  @RequirePermission('Prescription', 'read')
  async getQueue() {
    return this.pharmacyService.getQueue();
  }

  @Get('prescriptions/:id/batches')
  @RequirePermission('Prescription', 'read')
  async getBatchOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.pharmacyService.getBatchOptions(id);
  }

  @Post('dispense')
  @RequirePermission('StockTransaction', 'dispense')
  async dispense(@Body() dto: DispenseMedicineDto, @Req() req: any) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) throw new UnauthorizedException('User context missing');
    const userRole = req.user?.roleName || req.user?.role || 'Pharmacist';
    return this.pharmacyService.dispense(dto, userId, userRole);
  }
}
