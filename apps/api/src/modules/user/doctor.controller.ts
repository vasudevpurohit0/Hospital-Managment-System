import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  @RequirePermission('Doctor', 'read')
  async findAll() {
    return this.doctorService.findAllDoctors();
  }

  /** Admin roster: includes deactivated doctors too, so they can be reactivated. */
  @Get('admin')
  @RequirePermission('Doctor', 'update')
  async findAllForAdmin() {
    return this.doctorService.findAllDoctorsForAdmin();
  }

  @Post()
  @RequirePermission('Doctor', 'create')
  async createDoctor(@Body() body: CreateDoctorDto) {
    return this.doctorService.createDoctor(body);
  }

  @Patch(':id')
  @RequirePermission('Doctor', 'update')
  async updateDoctor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorService.updateDoctor(id, dto);
  }

  @Patch(':id/active')
  @RequirePermission('Doctor', 'delete')
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body('active') active: boolean) {
    return this.doctorService.setActive(id, active);
  }
}
