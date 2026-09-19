import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from './email.service';

/** Account activation/credential emails are needed by both the Staff and Doctor modules, so this is registered globally rather than re-imported by each. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
