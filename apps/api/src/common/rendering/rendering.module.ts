import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentRenderService } from './document-render.service';

/**
 * PDF rendering is needed across billing, laboratory and reporting, so —
 * like DocumentSequenceService — it is registered globally rather than
 * re-imported by every consumer.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [DocumentRenderService],
  exports: [DocumentRenderService],
})
export class RenderingModule {}
