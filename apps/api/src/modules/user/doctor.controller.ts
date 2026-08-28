import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  @Public()
  async findAll() {
    return this.doctorService.findAllDoctors();
  }

  @Post()
  @Public() // Or apply specific guard if needed, but keeping simple for demo
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
