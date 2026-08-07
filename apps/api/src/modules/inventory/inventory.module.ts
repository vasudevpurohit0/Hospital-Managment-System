import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { ExpiryScannerService } from './services/expiry-scanner.service';
import { ProcurementModule } from '../procurement/procurement.module';

@Module({
  imports: [ProcurementModule],
  controllers: [InventoryController],
  providers: [InventoryService, ExpiryScannerService],
  exports: [InventoryService, ExpiryScannerService],
})
export class InventoryModule {}
