import { PrismaService } from '../prisma/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import { SEQUENCES, SequenceKey } from './sequence.definitions';

/**
 * These exercise the real database, because the properties under test —
 * atomic allocation under concurrency, survival across a process restart,
 * and rollback with the caller's transaction — only exist in Postgres. A
 * mocked client would assert nothing.
 *
 * Skipped automatically when no DATABASE_URL is configured so unit-only runs
 * (and CI without a database) stay green.
 */
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('DocumentSequenceService (integration)', () => {
  let prisma: PrismaService;
  let service: DocumentSequenceService;

  // Unique per run so repeated local runs never collide with each other or
  // with real hospital counters.
  const testDept = `ZZTEST${Date.now().toString().slice(-6)}`;

  /**
   * Two cases below exercise the registered production counters (OPD, LAB,
   * RECEIPT, SAMPLE) because their formats are the thing under test. Their
   * values are captured up front and restored afterwards, so running the suite
   * does not consume real document numbers or leave gaps in them.
   */
  const REGISTERED: SequenceKey[] = ['OPD_NUMBER', 'LAB_NUMBER', 'RECEIPT_NUMBER', 'SAMPLE_CODE'];
  const originalValues = new Map<string, number | null>();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new DocumentSequenceService(prisma);

    for (const key of REGISTERED) {
      const row = await prisma.documentSequence.findUnique({
        where: {
          name_periodKey: {
            name: SEQUENCES[key].name,
            periodKey: String(new Date().getFullYear()),
          },
        },
        select: { lastValue: true },
      });
      originalValues.set(SEQUENCES[key].name, row ? row.lastValue : null);
    }
  });

  afterAll(async () => {
    await prisma.documentSequence.deleteMany({
      where: { name: { startsWith: 'TOKEN:ZZTEST' } },
    });

    const periodKey = String(new Date().getFullYear());
    for (const [name, original] of originalValues) {
      if (original === null) {
        // The counter did not exist before this run; remove it entirely.
        await prisma.documentSequence.deleteMany({ where: { name, periodKey } });
      } else {
        await prisma.documentSequence.updateMany({
          where: { name, periodKey },
          data: { lastValue: original },
        });
      }
    }

    await prisma.$disconnect();
  });

  it('issues sequential, zero-padded tokens for a department', async () => {
    const first = await service.nextQueueToken(testDept);
    const second = await service.nextQueueToken(testDept);
    const third = await service.nextQueueToken(testDept);

    expect(first).toBe(`${testDept}-001`);
    expect(second).toBe(`${testDept}-002`);
    expect(third).toBe(`${testDept}-003`);
  });

  it('keeps counters independent per department', async () => {
    const other = `${testDept}B`;
    const mine = await service.nextQueueToken(testDept);
    const theirs = await service.nextQueueToken(other);

    expect(mine).toBe(`${testDept}-004`);
    expect(theirs).toBe(`${other}-001`);
  });

  // The defect this service replaces: counters lived in a per-process Map, so
  // a restart reset the day's numbering and handed two patients the same token.
  it('resumes numbering after a service instance is discarded', async () => {
    const beforeRestart = await service.nextQueueToken(testDept);

    const freshInstance = new DocumentSequenceService(prisma);
    const afterRestart = await freshInstance.nextQueueToken(testDept);

    expect(beforeRestart).toBe(`${testDept}-005`);
    expect(afterRestart).toBe(`${testDept}-006`);
  });

  it('issues no duplicates when callers allocate concurrently', async () => {
    const concurrent = `${testDept}C`;
    const issued = await Promise.all(
      Array.from({ length: 25 }, () => service.nextQueueToken(concurrent)),
    );

    expect(new Set(issued).size).toBe(25);
    expect([...issued].sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `${concurrent}-${String(i + 1).padStart(3, '0')}`).sort(),
    );
  });

  it('releases the number when the caller transaction rolls back', async () => {
    const rollback = `${testDept}R`;

    const committed = await prisma.$transaction((tx) => service.nextQueueToken(rollback, tx));
    expect(committed).toBe(`${rollback}-001`);

    await expect(
      prisma.$transaction(async (tx) => {
        await service.nextQueueToken(rollback, tx);
        throw new Error('visit creation failed');
      }),
    ).rejects.toThrow('visit creation failed');

    // The abandoned number is reused rather than burned, so the day's tokens
    // stay gap-free.
    const next = await service.nextQueueToken(rollback);
    expect(next).toBe(`${rollback}-002`);
  });

  it('formats registered document numbers to their documented shape', async () => {
    const year = new Date().getFullYear();

    const opd = await service.next('OPD_NUMBER');
    const lab = await service.next('LAB_NUMBER');
    const receipt = await service.next('RECEIPT_NUMBER');
    const sample = await service.next('SAMPLE_CODE');

    expect(opd).toMatch(new RegExp(`^OPD/${year}/\\d{6}$`));
    expect(lab).toMatch(new RegExp(`^LAB/${year}/\\d{5}$`));
    expect(receipt).toMatch(new RegExp(`^RCPT/${year}/\\d{6}$`));
    expect(sample).toMatch(new RegExp(`^S${String(year).slice(2)}-\\d{7}$`));
  });

  it('advances a counter past backfilled identifiers without lowering it', async () => {
    const before = await service.peek('OPD_NUMBER');

    await service.reserveUpTo('OPD_NUMBER', before + 500);
    expect(await service.peek('OPD_NUMBER')).toBe(before + 500);

    // A lower floor must never rewind a counter, or numbers would be reissued.
    await service.reserveUpTo('OPD_NUMBER', 1);
    expect(await service.peek('OPD_NUMBER')).toBe(before + 500);

    const next = await service.next('OPD_NUMBER');
    expect(Number(next.split('/')[2])).toBe(before + 501);
  });

  it('exposes a padding wide enough for every registered sequence', () => {
    for (const definition of Object.values(SEQUENCES)) {
      expect(definition.padding).toBeGreaterThanOrEqual(5);
    }
  });
});
