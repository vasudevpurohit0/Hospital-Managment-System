import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class HospitalUidGeneratorService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generates a unique, permanent Hospital UID code formatted as ESIC-{YYYY}-{SEQUENCE}
   * e.g. ESIC-2026-000001
   */
  async generateUid(): Promise<string> {
    const year = new Date().getFullYear();

    const prefix = `ESIC-${year}-`;
    
    // Get the latest issued UID for this year
    const latestUid = await this.prisma.hospitalUID.findFirst({
      where: {
        uidCode: {
          startsWith: prefix,
        },
      },
      orderBy: {
        uidCode: 'desc',
      },
    });

    let nextSeq = 1;
    if (latestUid) {
      // Extract the sequence part and increment
      const parts = latestUid.uidCode.split('-');
      if (parts.length === 3) {
        const lastSeq = parseInt(parts[2], 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }
    }

    const sequence = nextSeq.toString().padStart(6, '0');
    return `${prefix}${sequence}`;
  }
}
