import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { UpdateHospitalStatusDto } from './dto/update-hospital-status.dto';
import { ResetHospitalUserPasswordDto } from './dto/reset-hospital-user-password.dto';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';

@Controller('platform/hospitals')
@UseGuards(PlatformOnlyGuard)
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @Get()
  async list() {
    return this.hospitals.list();
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    const hospital = await this.hospitals.getById(id);
    if (!hospital) throw new NotFoundException(`Hospital not found: ${id}`);
    return hospital;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateHospitalDto) {
    return this.hospitals.createHospital(dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHospitalDto) {
    return this.hospitals.update(id, dto);
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHospitalStatusDto) {
    return this.hospitals.setStatus(id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetHospitalUserPasswordDto) {
    return this.hospitals.resetHospitalUserPassword(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.hospitals.remove(id);
  }
}
