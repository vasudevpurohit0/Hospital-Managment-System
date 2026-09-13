import { Test, TestingModule } from '@nestjs/testing';
import { OpdTokenGeneratorService } from './opd-token-generator.service';
import { DocumentSequenceService } from '../../../common/sequence/document-sequence.service';

describe('OpdTokenGeneratorService', () => {
  let service: OpdTokenGeneratorService;
  let sequences: { nextQueueToken: jest.Mock };

  beforeEach(async () => {
    sequences = { nextQueueToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpdTokenGeneratorService,
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();

    service = module.get(OpdTokenGeneratorService);
  });

  it('delegates token issuance to the database-backed sequence service', async () => {
    sequences.nextQueueToken.mockResolvedValue('CARDIO-001');

    await expect(service.generateDailyToken('CARDIO')).resolves.toBe('CARDIO-001');
    expect(sequences.nextQueueToken).toHaveBeenCalledWith('CARDIO', undefined);
  });

  // The token must be reserved inside the caller's transaction so a failed
  // visit creation releases it instead of leaving a gap in the day's numbering.
  it('forwards the caller transaction so the token rolls back with the visit', async () => {
    const tx = { $queryRaw: jest.fn() };
    sequences.nextQueueToken.mockResolvedValue('ORTHO-004');

    await service.generateDailyToken('ORTHO', tx as never);

    expect(sequences.nextQueueToken).toHaveBeenCalledWith('ORTHO', tx);
  });

  it('propagates sequence failures rather than issuing an unbacked token', async () => {
    sequences.nextQueueToken.mockRejectedValue(new Error('sequence unavailable'));

    await expect(service.generateDailyToken('ENT')).rejects.toThrow('sequence unavailable');
  });
});
