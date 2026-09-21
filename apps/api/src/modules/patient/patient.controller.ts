import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
  Header,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PatientService } from './patient.service';
import { PatientHistoryService } from './patient-history.service';
import {
  RegisterPatientDto,
  VerifyEmployeeDto,
  CreatePatientVisitDto,
  PatientSearchQueryDto,
  UpdatePatientProfileDto,
} from './dto/patient-register.dto';
import { RequirePermission, hasPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { toTenantActorUserId } from '../../common/audit/audit-actor.util';
import { DocumentRenderService } from '../../common/rendering/document-render.service';
import { renderPatientHistoryHtml } from '../../common/rendering/pdf-templates';

@Controller('patients')
export class PatientController {
  constructor(
    private readonly patientService: PatientService,
    private readonly patientHistoryService: PatientHistoryService,
    private readonly documentRender: DocumentRenderService,
  ) {}

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
    return this.patientService.registerPatient(dto, toTenantActorUserId(user));
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
  async searchPatients(@Query() queryDto: PatientSearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientService.searchPatients(queryDto, user);
  }

  @Post('visit')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Visit', 'create')
  async createVisit(
    @Body() dto: CreatePatientVisitDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.patientService.createVisit(dto, toTenantActorUserId(user));
  }

  // V-06: these two return full diagnoses/prescriptions/lab results/therapy
  // history, not just identity/registration data -- Employee:read (held by
  // front-desk/data-entry/pharmacy/lab-logistics roles that have no clinical
  // justification for it) was never the right gate for that. PatientHistory
  // is granted only to Doctor/Nurse/Administrator/Pathologist.
  @Get(':id/history')
  @RequirePermission('PatientHistory', 'read')
  async getPatientMedicalHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientService.getPatientMedicalHistory(id, {
      canViewBilling: hasPermission(user.permissions, 'Charge', 'read'),
    });
  }

  @Get(':id/master')
  @RequirePermission('PatientHistory', 'read')
  async getPatientMasterRecord(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientService.getPatientMasterRecord(id, {
      canViewBilling: hasPermission(user.permissions, 'Charge', 'read'),
    });
  }

  // Complete clinical timeline (registration → visits → consultations →
  // labs → prescriptions → dispensing → admissions → discharge → billing),
  // gated by the same PatientHistory:read permission as the two endpoints
  // above. Billing figures inside the response are additionally gated on
  // Charge:read -- a role that holds PatientHistory:read but not Charge:read
  // (e.g. Pathologist) gets `billing.authorized: false` and zeroed amounts,
  // never the real figures.
  @Get(':id/timeline')
  @RequirePermission('PatientHistory', 'read')
  async getPatientTimeline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientHistoryService.getPatientTimeline(id, {
      canViewBilling: hasPermission(user.permissions, 'Charge', 'read'),
    });
  }

  /** The downloadable "Clinical Report PDF" -- same data and same authorization as getPatientTimeline above, rendered through the shared Puppeteer pipeline. */
  @Get(':id/timeline/pdf')
  @RequirePermission('PatientHistory', 'read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Content-Type', 'application/pdf')
  async getPatientTimelinePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const report = await this.patientHistoryService.getPatientTimeline(id, {
      canViewBilling: hasPermission(user.permissions, 'Charge', 'read'),
    });
    const branding = await this.documentRender.getBranding();
    const pdf = await this.documentRender.renderPdf(renderPatientHistoryHtml(branding, report), {
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;padding:2px 0;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    const dateSlug = new Date().toISOString().slice(0, 10);
    // Filename carries the Employee ID (already used the same way in
    // statement-<employeeId>.pdf), not the patient's name -- privacy rule
    // #32 asks not to put patient information in the filename unnecessarily.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Clinical_Report_${report.patient.employeeId}_${dateSlug}.pdf"`,
    );
    res.send(pdf);
  }

  @Put(':id')
  @RequirePermission('Employee', 'update')
  async updatePatientProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientProfileDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.patientService.updatePatientProfile(id, dto, toTenantActorUserId(user));
  }
}
