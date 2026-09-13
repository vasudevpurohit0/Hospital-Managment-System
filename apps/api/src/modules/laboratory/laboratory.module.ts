import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';
import { LabService } from './lab.service';
import { LabController } from './lab.controller';

@Module({
  imports: [PrismaModule, BillingModule, BenefitModule],
  controllers: [LabController],
  providers: [LabService],
  exports: [LabService],
})
export class LaboratoryModule {}
