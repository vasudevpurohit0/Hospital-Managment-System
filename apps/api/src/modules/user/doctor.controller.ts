import { Controller, Get, Post, Body } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  @RequirePermission('Doctor', 'read')
  async findAll() {
    return this.doctorService.findAllDoctors();
  }

  @Post()
  @RequirePermission('Doctor', 'create')
  async createDoctor(
    @Body()
    body: {
      name: string;
      specialty: string;
      experience: string;
      timing: string;
      email: string;
    },
  ) {
    return this.doctorService.createDoctor(body);
  }
}
