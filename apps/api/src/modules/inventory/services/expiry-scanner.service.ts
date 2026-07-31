import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StockStatus } from '@prisma/client';

export interface ScanResult {
  quarantinedCount: number;
  criticalCount: number;
  earlyCount: number;
  scannedAt: string;
}

@Injectable()
export class ExpiryScannerService {
  private readonly logger = new Logger(ExpiryScannerService.name);

  constructor(private prisma: PrismaService) {}

  async runDailyScan(): Promise<ScanResult> {
    const now = new Date();
    const day90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    let quarantinedCount = 0;
    let criticalCount = 0;
    let earlyCount = 0;

    // 1. Expired batches -> transition to QUARANTINED (blocking FEFO queries)
    const expiredBatches = await this.prisma.medicineBatch.findMany({
      where: {
        expiryDate: { lte: now },
        stockStatus: {
          notIn: [StockStatus.EXPIRED, StockStatus.QUARANTINED, StockStatus.DISPOSED],
        },
      },
    });

    for (const batch of expiredBatches) {
      await this.prisma.medicineBatch.update({
        where: { id: batch.id },
        data: { stockStatus: StockStatus.QUARANTINED },
      });
      quarantinedCount++;
    }

    // 2. Critical Alert (expiry <= 30 days)
    const criticalBatches = await this.prisma.medicineBatch.findMany({
      where: {
        expiryDate: { gt: now, lte: day30 },
        stockStatus: { in: [StockStatus.IN_STOCK, StockStatus.EARLY_WARNING] },
      },
    });

    for (const batch of criticalBatches) {
      await this.prisma.medicineBatch.update({
        where: { id: batch.id },
        data: { stockStatus: StockStatus.CRITICAL_ALERT },
      });
      criticalCount++;
    }

    // 3. Early Warning (expiry <= 90 days)
    const earlyBatches = await this.prisma.medicineBatch.findMany({
      where: {
        expiryDate: { gt: day30, lte: day90 },
        stockStatus: StockStatus.IN_STOCK,
      },
    });

    for (const batch of earlyBatches) {
      await this.prisma.medicineBatch.update({
        where: { id: batch.id },
        data: { stockStatus: StockStatus.EARLY_WARNING },
      });
      earlyCount++;
    }

    this.logger.log(
      `[ExpiryScanner] Completed scan: ${quarantinedCount} quarantined, ${criticalCount} critical, ${earlyCount} early warning.`,
    );

    return {
      quarantinedCount,
      criticalCount,
      earlyCount,
      scannedAt: now.toISOString(),
    };
  }
}
