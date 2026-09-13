import { Module } from '@nestjs/common';
import { AdmissionController } from './admission.controller';
import { AdmissionService } from './admission.service';
import { IpdFinanceController } from './ipd-finance.controller';
import { IpdFinanceService } from './ipd-finance.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { FacilityModule } from '../facility/facility.module';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';

@Module({
  imports: [PrismaModule, FacilityModule, BillingModule, BenefitModule],
  controllers: [AdmissionController, IpdFinanceController],
  providers: [AdmissionService, IpdFinanceService],
  exports: [AdmissionService, IpdFinanceService],
})
export class AdmissionModule {}
