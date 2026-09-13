import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';
import { TherapyService } from './therapy.service';
import { TherapyController } from './therapy.controller';

@Module({
  imports: [PrismaModule, BillingModule, BenefitModule],
  controllers: [TherapyController],
  providers: [TherapyService],
  exports: [TherapyService],
})
export class TherapyModule {}
