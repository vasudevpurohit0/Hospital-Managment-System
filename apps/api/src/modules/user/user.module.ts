import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UserController, DoctorController, StaffController],
  providers: [UserService, DoctorService, StaffService],
})
export class UserModule {}
