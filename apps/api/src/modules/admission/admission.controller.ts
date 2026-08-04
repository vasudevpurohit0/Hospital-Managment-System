import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AdmissionService } from './admission.service';
import { AllocateBedDto } from './dto/allocate-bed.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { DischargeDto } from './dto/discharge.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('admissions')
@UseGuards(JwtAuthGuard)
export class AdmissionController {
  constructor(private readonly service: AdmissionService) {}

  @Get()
  @RequirePermission('Admission', 'read')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermission('Admission', 'read')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/resolve')
  @RequirePermission('Admission', 'update')
  async resolveEligibility(@Param('id') id: string) {
    return this.service.resolveEligibility(id);
  }

  @Get(':id/eligible-beds')
  @RequirePermission('Admission', 'read')
  async findAvailableBeds(@Param('id') id: string) {
    return this.service.findAvailableBeds(id);
  }

  @Get('wards/all')
  @RequirePermission('Admission', 'read')
  async findAllWards() {
    return this.service.findAllWards();
  }

  @Post('beds')
  @RequirePermission('Admission', 'update')
  async createWardAndBed(
    @Body()
    dto: {
      wardId?: string;
      wardName?: string;
      wardCategory?: string;
      roomNumber: string;
      bedNumber?: string;
      bedNumbers?: string[];
      count?: number;
    },
  ) {
    return this.service.createWardAndBed(dto);
  }

  @Delete('wards/:id')
  @RequirePermission('Admission', 'update')
  async deleteWard(@Param('id') id: string) {
    return this.service.deleteWard(id);
  }

  @Delete('beds/:id')
  @RequirePermission('Admission', 'update')
  async deleteBed(@Param('id') id: string) {
    return this.service.deleteBed(id);
  }

  @Post(':id/allocate')
  @RequirePermission('Admission', 'update')
  async allocateBed(
    @Param('id') id: string,
    @Body() dto: AllocateBedDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.allocateBed(id, dto, user?.id);
  }

  @Post(':id/notes')
  @RequirePermission('AdmissionNote', 'create')
  async addNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user) {
      throw new Error('User context missing');
    }
    return this.service.addNote(id, dto, user.id);
  }

  @Post(':id/discharge')
  @RequirePermission('Admission', 'approve')
  async discharge(
    @Param('id') id: string,
    @Body() dto: DischargeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user) {
      throw new Error('User context missing');
    }
    return this.service.discharge(id, dto, user.id, user.roleName);
  }
}
