import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BenefitModule } from '../benefit/benefit.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { ChargeService } from './charge.service';
import { ReceiptService } from './receipt.service';
import { ChargeController } from './charge.controller';

/**
 * The billing module now houses two things:
 *  - the legacy pharmacy-only screen (BillingService/BillingController),
 *    read-adapted onto ChargeItem but otherwise unchanged;
 *  - the unified charge ledger and receipting (ChargeService, ReceiptService,
 *    ChargeController), which every other module's charge-posting depends on.
 *
 * DocumentSequenceService is not imported here — SequenceModule is @Global.
 */
@Module({
  imports: [PrismaModule, CatalogModule, BenefitModule],
  controllers: [BillingController, ChargeController],
  providers: [BillingService, ChargeService, ReceiptService],
  exports: [BillingService, ChargeService, ReceiptService],
})
export class BillingModule {}
