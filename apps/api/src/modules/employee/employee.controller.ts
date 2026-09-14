import { Controller, Get, Post, Body, Param, Put, HttpCode, HttpStatus } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { EmployeeVerificationService } from './services/employee-verification.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateEmployeeSimpleDto } from './dto/create-employee-simple.dto';
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
  async findOne(@Param('id') id: string) {
    return this.employeeService.findOne(id);
  }

  @Put(':id')
  @RequirePermission('Employee', 'update')
  async update(@Param('id') id: string, @Body() updateDto: Partial<CreateEmployeeDto>) {
    return this.employeeService.update(id, updateDto);
  }
}
