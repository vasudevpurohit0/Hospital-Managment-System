import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';

/**
 * The service catalogue and its pricing.
 *
 * PricingService is exported because it is the only sanctioned way for any
 * other module (laboratory, therapy, billing) to obtain a rate.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CatalogController],
  providers: [CatalogService, PricingService],
  exports: [CatalogService, PricingService],
})
export class CatalogModule {}
