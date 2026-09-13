import { Module } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { EmployeeModule } from '../employee/employee.module';
import { OpdModule } from '../opd/opd.module';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';

@Module({
  imports: [EmployeeModule, OpdModule, BillingModule, BenefitModule],
  controllers: [PatientController],
  providers: [PatientService],
  exports: [PatientService],
})
export class PatientModule {}
