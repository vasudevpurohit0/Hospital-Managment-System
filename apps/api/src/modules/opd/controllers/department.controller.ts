import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DepartmentService } from '../services/department.service';
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /**
   * Backs the OPD registration department dropdown -- kept on the original
   * broad Employee:read grant (most roles already have it) rather than the
   * new Department:read permission, so this doesn't regress access for
   * whoever was already relying on it.
   */
  @Get()
  @RequirePermission('Employee', 'read')
  async findAll() {
    return this.departmentService.findAll();
  }

  /** Admin roster: includes deactivated departments too, so they can be reactivated. */
  @Get('admin')
  @RequirePermission('Department', 'read')
  async findAllForAdmin() {
    return this.departmentService.findAll(true);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Department', 'create')
  async create(@Body() dto: CreateDepartmentDto) {
    return this.departmentService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('Department', 'update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentService.update(id, dto);
  }

  @Patch(':id/active')
  @RequirePermission('Department', 'delete')
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body('active') active: boolean) {
    return this.departmentService.setActive(id, active);
  }
}
