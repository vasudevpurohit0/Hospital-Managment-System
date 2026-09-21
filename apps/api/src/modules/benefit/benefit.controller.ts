import { Controller, Get, Post, Put, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { BenefitRuleService } from './benefit-rule.service';
import { CreateBenefitRuleDto } from './dto/create-benefit-rule.dto';
import { UpdateBenefitRuleDto } from './dto/update-benefit-rule.dto';
import { EvaluateBenefitQueryDto } from './dto/evaluate-benefit-query.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('benefit-rules')
@UseGuards(JwtAuthGuard)
export class BenefitController {
  constructor(private readonly benefitRuleService: BenefitRuleService) {}

  @Get()
  @RequirePermission('Employee', 'read')
  async findAll() {
    return this.benefitRuleService.findAll();
  }

  @Post()
  @RequirePermission('BenefitRule', 'create')
  async createRule(@Body() dto: CreateBenefitRuleDto) {
    return this.benefitRuleService.create(dto);
  }

  @Put(':id')
  @RequirePermission('BenefitRule', 'update')
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBenefitRuleDto) {
    return this.benefitRuleService.update(id, dto);
  }

  @Get('evaluate')
  @RequirePermission('Employee', 'read')
  async evaluateRule(@Query() query: EvaluateBenefitQueryDto) {
    const outcome = await this.benefitRuleService.evaluate(
      query.employmentType,
      query.medicineCategory,
    );
    return {
      employmentType: query.employmentType,
      medicineCategory: query.medicineCategory || null,
      outcome,
    };
  }
}
