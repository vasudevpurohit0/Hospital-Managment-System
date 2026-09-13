import { Module } from '@nestjs/common';
import { DepartmentService } from './services/department.service';
import { DepartmentController } from './controllers/department.controller';
import { OpdTokenGeneratorService } from './services/opd-token-generator.service';
import { OpdService } from './services/opd.service';
import { OpdController } from './controllers/opd.controller';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';

@Module({
  imports: [BillingModule, BenefitModule],
  controllers: [DepartmentController, OpdController],
  providers: [DepartmentService, OpdTokenGeneratorService, OpdService],
  exports: [DepartmentService, OpdTokenGeneratorService, OpdService],
})
export class OpdModule {}
