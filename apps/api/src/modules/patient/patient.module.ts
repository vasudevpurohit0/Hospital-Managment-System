import { Module } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { EmployeeModule } from '../employee/employee.module';
import { OpdModule } from '../opd/opd.module';

@Module({
  imports: [EmployeeModule, OpdModule],
  controllers: [PatientController],
  providers: [PatientService],
  exports: [PatientService],
})
export class PatientModule {}
