import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Put, HttpCode, HttpStatus, ForbiddenException, BadRequestException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EmployeeService } from './employee.service';
import {
  generateEmployeeTemplateCsv,
  generateEmployeeErrorReportCsv,
  ParsedEmployeeRow,
} from './csv/employee-csv.util';
import { EmployeeVerificationService } from './services/employee-verification.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSimpleDto } from './dto/create-employee-simple.dto';
import { UpdateEmployeeDto, EMPLOYEE_RECLASSIFICATION_FIELDS } from './dto/update-employee.dto';
import { VerifyEmployeeReqDto } from './dto/verify-employee-req.dto';
import { RegisterEmployeeReqDto } from './dto/register-employee-req.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly verificationService: EmployeeVerificationService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Employee', 'read')
  async verifyEmployee(@Body() dto: VerifyEmployeeReqDto) {
    return this.verificationService.verifyEmployee(dto.employeeId);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Employee', 'create')
  async registerEmployee(
    @Body() dto: RegisterEmployeeReqDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.verificationService.registerEmployee(dto.employeeId, user?.id);
  }

  @Get(':uid/card')
  @RequirePermission('HospitalUID', 'read')
  async getUidCardData(@Param('uid') uid: string) {
    return this.verificationService.getUidCardData(uid);
  }

  @Post()
  @RequirePermission('Employee', 'create')
  async create(@Body() createEmployeeDto: CreateEmployeeDto) {
    return this.employeeService.create(createEmployeeDto);
  }

  @Post('simple')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Employee', 'create')
  async createSimple(@Body() dto: CreateEmployeeSimpleDto) {
    return this.employeeService.createSimple(dto);
  }

  // --- Bulk Employee Import (CSV) --------------------------------------
  // Every route below is gated on the SAME Employee:create permission the
  // manual "Add Employee" form uses, so bulk import is available to exactly
  // the roles already allowed to create employees (Data Entry Operator,
  // Reception, Administrator, SuperAdmin) and no others. Tenant scope is
  // enforced automatically -- the service reads/writes only this hospital's
  // schema via the tenant-scoped Prisma client.

  /** Downloadable CSV template (header + two example rows). */
  @Get('import/template')
  @RequirePermission('Employee', 'create')
  downloadImportTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="employee_import_template.csv"');
    res.send(generateEmployeeTemplateCsv());
  }

  /** Validate an uploaded CSV (base64) -- returns the per-row preview, writes nothing. */
  @Post('import/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Employee', 'create')
  async validateImport(@Body() body: { fileBase64?: string }) {
    if (!body?.fileBase64 || typeof body.fileBase64 !== 'string') {
      throw new BadRequestException('No CSV file provided.');
    }
    const cleanBase64 = body.fileBase64.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    this.employeeService.assertImportSizeOk(buffer.byteLength);
    const text = buffer.toString('utf-8');
    try {
      return await this.employeeService.validateEmployeeImport(text);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Could not read the CSV file.');
    }
  }

  /** Atomically import the provided rows (re-validated server-side). */
  @Post('import/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Employee', 'create')
  async confirmImport(@Body() body: { rows?: ParsedEmployeeRow[] }) {
    if (!body?.rows || !Array.isArray(body.rows)) {
      throw new BadRequestException('Invalid import payload.');
    }
    return this.employeeService.confirmEmployeeImport(body.rows);
  }

  /** Downloadable CSV of failed rows + reasons. */
  @Post('import/error-report')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Employee', 'create')
  downloadErrorReport(
    @Body() body: { rows?: { rowNum: number; employeeId: string; error: string; original: Partial<ParsedEmployeeRow> }[] },
    @Res() res: Response,
  ) {
    if (!body?.rows || !Array.isArray(body.rows)) {
      throw new BadRequestException('No error rows provided.');
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="employee_import_errors.csv"');
    res.send(generateEmployeeErrorReportCsv(body.rows));
  }

  @Get()
  @RequirePermission('Employee', 'read')
  async findAll() {
    return this.employeeService.findAll();
  }

  @Get('post-grade-options')
  @RequirePermission('Employee', 'read')
  async getPostGradeOptions() {
    return this.employeeService.getPostGradeOptions();
  }

  @Get(':id')
  @RequirePermission('Employee', 'read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.findOne(id);
  }

  @Put(':id')
  @RequirePermission('Employee', 'update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateEmployeeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    // Reclassification (post/grade/employment type) feeds benefit
    // eligibility and pay-grade-linked billing, so plain Employee:update
    // (also held by Reception/DataEntryOperator for demographic-only edits)
    // is not enough to change these fields -- requires Employee:reclassify.
    const attemptsReclassification = EMPLOYEE_RECLASSIFICATION_FIELDS.some(
      (field) => updateDto[field] !== undefined,
    );
    if (attemptsReclassification && user?.type !== 'platform') {
      const canReclassify = user?.permissions?.some(
        (p) =>
          (p.resource === '*' || p.resource === 'Employee') &&
          (p.action === '*' || p.action === 'reclassify'),
      );
      if (!canReclassify) {
        throw new ForbiddenException(
          'Changing post, grade, or employment type requires the Employee:reclassify permission.',
        );
      }
    }
    return this.employeeService.update(id, updateDto);
  }
}
