import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('visits')
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Post()
  @RequirePermission('Employee', 'read')
  async createVisit(@Body() createVisitDto: CreateVisitDto) {
    return this.visitService.createVisit(createVisitDto);
  }

  @Get('employee/:employeeId')
  @RequirePermission('Employee', 'read')
  async findVisitsByEmployee(@Param('employeeId') employeeId: string) {
    return this.visitService.findVisitsByEmployee(employeeId);
  }

  @Get(':id')
  @RequirePermission('Visit', 'read')
  async findOne(@Param('id') id: string) {
    return this.visitService.findOne(id);
  }
}
