import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SEQUENCES,
  SequenceDefinition,
  SequenceKey,
  queueTokenSequence,
  staffIdSequence,
} from './sequence.definitions';

/**
 * Either the root Prisma client or an interactive transaction client. Callers
 * that already hold a transaction pass it in so the number they reserve is
 * committed or rolled back together with the record it belongs to.
 */
export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class DocumentSequenceService {
  private readonly logger = new Logger(DocumentSequenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocates the next number for a registered sequence.
   *
   * Pass `tx` whenever the caller is inside a transaction: a rolled-back
   * transaction then releases the number instead of burning it.
   */
  async next(key: SequenceKey, tx?: PrismaClientLike): Promise<string> {
    return this.allocate(SEQUENCES[key], tx);
  }

  /** Allocates the next daily queue token for a department, e.g. CARDIO-001. */
  async nextQueueToken(departmentCode: string, tx?: PrismaClientLike): Promise<string> {
    return this.allocate(queueTokenSequence(departmentCode), tx);
  }

  /** Allocates the next staff ID for a role prefix, e.g. NUR-0001. Never resets. */
  async nextStaffId(rolePrefix: string, tx?: PrismaClientLike): Promise<string> {
    return this.allocate(staffIdSequence(rolePrefix), tx);
  }

  /**
   * Reads the current value of a sequence without consuming a number.
   * Intended for administrative display and for tests; never for issuing.
   */
  async peek(key: SequenceKey, at: Date = new Date()): Promise<number> {
    const definition = SEQUENCES[key];
    const row = await this.prisma.documentSequence.findUnique({
      where: {
        name_periodKey: {
          name: definition.name,
          periodKey: this.periodKeyFor(definition.reset, at),
        },
      },
      select: { lastValue: true },
    });
    return row?.lastValue ?? 0;
  }

  /**
   * Raises a counter so the next issued number is greater than `minimum`.
   * Used when backfilling identifiers onto existing rows, so newly issued
   * numbers cannot collide with backfilled ones. Never lowers a counter.
   */
  async reserveUpTo(key: SequenceKey, minimum: number, tx?: PrismaClientLike): Promise<void> {
    const definition = SEQUENCES[key];
    const client = tx ?? this.prisma;
    const periodKey = this.periodKeyFor(definition.reset, new Date());

    await client.$executeRaw`
      INSERT INTO "document_sequences"
        ("id", "name", "prefix", "period_key", "last_value", "padding", "created_at", "updated_at")
      VALUES
        (gen_random_uuid(), ${definition.name}, ${''}, ${periodKey},
         ${minimum}, ${definition.padding}, now(), now())
      ON CONFLICT ("name", "period_key") DO UPDATE
        SET "last_value" = GREATEST("document_sequences"."last_value", ${minimum}),
            "updated_at" = now()
    `;
  }

  /**
   * Atomically reserves the next value and renders it.
   *
   * The INSERT ... ON CONFLICT DO UPDATE performs the read, the increment and
   * the write as one statement, so concurrent callers serialise on the row lock
   * that Postgres takes for the conflicting row. Nothing is held in process
   * memory, so counters survive a restart and are correct across instances.
   */
  private async allocate(definition: SequenceDefinition, tx?: PrismaClientLike): Promise<string> {
    const client = tx ?? this.prisma;
    const periodKey = this.periodKeyFor(definition.reset, new Date());

    const rows = await client.$queryRaw<{ last_value: number }[]>`
      INSERT INTO "document_sequences"
        ("id", "name", "prefix", "period_key", "last_value", "padding", "created_at", "updated_at")
      VALUES
        (gen_random_uuid(), ${definition.name}, ${''}, ${periodKey},
         1, ${definition.padding}, now(), now())
      ON CONFLICT ("name", "period_key") DO UPDATE
        SET "last_value" = "document_sequences"."last_value" + 1,
            "updated_at" = now()
      RETURNING "last_value"
    `;

    const value = Number(rows[0]?.last_value);
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`Sequence "${definition.name}" returned no value`);
    }

    const code = definition.format(periodKey, String(value).padStart(definition.padding, '0'));
    this.logger.debug(`Issued ${definition.name} → ${code}`);
    return code;
  }

  /** Resolves the scope a counter resets on. */
  private periodKeyFor(reset: SequenceDefinition['reset'], at: Date): string {
    switch (reset) {
      case 'YEARLY':
        return String(at.getFullYear());
      case 'DAILY':
        // Local calendar date: a hospital day is a local-time concept, and the
        // OPD queue must reset at local midnight rather than at UTC midnight.
        return [
          at.getFullYear(),
          String(at.getMonth() + 1).padStart(2, '0'),
          String(at.getDate()).padStart(2, '0'),
        ].join('-');
      case 'NEVER':
        return 'GLOBAL';
    }
  }
}
