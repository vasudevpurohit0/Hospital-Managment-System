import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentSequenceService,
  PrismaClientLike,
} from '../../../common/sequence/document-sequence.service';

/**
 * Issues the daily OPD queue token for a department (e.g. CARDIO-001).
 *
 * Previously this held an in-memory Map of counters, which reset to zero on
 * every process restart and could not be shared between instances — two
 * patients could be handed the same token. Counting now happens in the
 * database via DocumentSequenceService.
 */
@Injectable()
export class OpdTokenGeneratorService {
  private readonly logger = new Logger(OpdTokenGeneratorService.name);

  constructor(private readonly sequences: DocumentSequenceService) {}

  /**
   * Reserves the next collision-free token for a department.
   *
   * Pass the caller's transaction so the token is released rather than burned
   * if visit creation subsequently fails.
   */
  async generateDailyToken(deptCode: string, tx?: PrismaClientLike): Promise<string> {
    const tokenNumber = await this.sequences.nextQueueToken(deptCode, tx);
    this.logger.log(`Issued daily queue token ${tokenNumber}`);
    return tokenNumber;
  }
}
