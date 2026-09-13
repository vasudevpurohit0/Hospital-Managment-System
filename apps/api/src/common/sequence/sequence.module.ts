import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentSequenceService } from './document-sequence.service';

/**
 * Document numbering is needed by OPD, admissions, laboratory and billing
 * alike, so the service is registered globally rather than re-imported by
 * every feature module.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [DocumentSequenceService],
  exports: [DocumentSequenceService],
})
export class SequenceModule {}
