import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacAdminService } from './rbac-admin.service';
import { RbacAdminController } from './rbac-admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RbacAdminController],
  providers: [RbacAdminService],
})
export class RbacAdminModule {}
