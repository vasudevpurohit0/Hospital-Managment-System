import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { BenefitModule } from '../benefit/benefit.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BenefitModule, ProcurementModule, BillingModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
