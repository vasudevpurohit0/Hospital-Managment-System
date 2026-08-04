import { Controller, Post, Put, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import { PrescriptionService } from './prescription.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('prescriptions')
@UseGuards(JwtAuthGuard)
export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  @Post()
  @RequirePermission('Prescription', 'create')
  async createPrescription(@Body() dto: CreatePrescriptionDto, @Req() req: any) {
    const doctorId = req.user?.id || req.user?.sub || '35b02c7d-cb73-405f-a239-e987c468d093';
    return this.prescriptionService.createPrescription(dto, doctorId);
  }

  @Put(':id')
  @RequirePermission('Prescription', 'update')
  async updatePrescription(@Param('id') id: string, @Body() dto: Partial<CreatePrescriptionDto>) {
    return this.prescriptionService.updatePrescription(id, dto);
  }

  @Post(':id/sign')
  @RequirePermission('Prescription', 'sign')
  async signPrescription(@Param('id') id: string, @Req() req: any) {
    const userRole = req.user?.roleName || req.user?.role || 'Doctor';
    return this.prescriptionService.signPrescription(id, userRole);
  }

  @Get('visit/:visitId')
  @RequirePermission('Employee', 'read')
  async findByVisit(@Param('visitId') visitId: string) {
    return this.prescriptionService.findByVisit(visitId);
  }
}
