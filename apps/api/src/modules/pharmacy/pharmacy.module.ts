import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { BenefitModule } from '../benefit/benefit.module';
import { ProcurementModule } from '../procurement/procurement.module';

@Module({
  imports: [BenefitModule, ProcurementModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
