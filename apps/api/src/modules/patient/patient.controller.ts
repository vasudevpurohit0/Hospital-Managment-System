import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PatientService } from './patient.service';
import {
  RegisterPatientDto,
  VerifyEmployeeDto,
  CreatePatientVisitDto,
  PatientSearchQueryDto,
  UpdatePatientProfileDto,
} from './dto/patient-register.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post('verify-employee')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Employee', 'read')
  async verifyEmployee(@Body() dto: VerifyEmployeeDto) {
    return this.patientService.verifyEmployee(dto);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Employee', 'create')
  async registerPatient(
    @Body() dto: RegisterPatientDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.patientService.registerPatient(dto, user?.id);
  }

  @Get('uid/:uid')
  @RequirePermission('HospitalUID', 'read')
  async getPatientByUid(@Param('uid') uid: string) {
    return this.patientService.getPatientByUid(uid);
  }

  @Get('employee/:employeeId')
  @RequirePermission('Employee', 'read')
  async getPatientByEmployeeId(@Param('employeeId') employeeId: string) {
    return this.patientService.getPatientByEmployeeId(employeeId);
  }

  @Get('search')
  @RequirePermission('Employee', 'read')
  async searchPatients(@Query() queryDto: PatientSearchQueryDto) {
    return this.patientService.searchPatients(queryDto);
  }

  @Post('visit')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Visit', 'create')
  async createVisit(
    @Body() dto: CreatePatientVisitDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.patientService.createVisit(dto, user?.id);
  }

  @Get(':id/history')
  @RequirePermission('Employee', 'read')
  async getPatientMedicalHistory(@Param('id') id: string) {
    return this.patientService.getPatientMedicalHistory(id);
  }

  @Put(':id')
  @RequirePermission('Employee', 'update')
  async updatePatientProfile(
    @Param('id') id: string,
    @Body() dto: UpdatePatientProfileDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.patientService.updatePatientProfile(id, dto, user?.id);
  }
}
