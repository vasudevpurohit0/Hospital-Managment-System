import { Controller, Post, Put, Get, Body, Param, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { PrescriptionService } from './prescription.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('prescriptions')
@UseGuards(JwtAuthGuard)
export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  @Post()
  @RequirePermission('Prescription', 'create')
  async createPrescription(@Body() dto: CreatePrescriptionDto, @Req() req: any) {
    const doctorId = req.user?.id || req.user?.sub;
    if (!doctorId) throw new UnauthorizedException('User context missing');
    return this.prescriptionService.createPrescription(dto, doctorId);
  }

  @Put(':id')
  @RequirePermission('Prescription', 'update')
  async updatePrescription(@Param('id') id: string, @Body() dto: UpdatePrescriptionDto) {
    return this.prescriptionService.updatePrescription(id, dto);
  }

  @Post(':id/sign')
  @RequirePermission('Prescription', 'sign')
  async signPrescription(@Param('id') id: string, @Req() req: any) {
    // No fallback default: JwtAuthGuard has already verified this request and
    // AuthenticatedUser.roleName is always populated for an authenticated
    // caller. Defaulting a missing/unexpected role to 'Doctor' here would
    // silently defeat signPrescription's own server-side role check below.
    const userRole = req.user?.roleName;
    if (!userRole) throw new UnauthorizedException('User context missing');
    return this.prescriptionService.signPrescription(id, userRole);
  }

  @Get('visit/:visitId')
  @RequirePermission('Employee', 'read')
  async findByVisit(@Param('visitId') visitId: string) {
    return this.prescriptionService.findByVisit(visitId);
  }
}
