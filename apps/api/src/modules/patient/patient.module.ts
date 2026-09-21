import { Module } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PatientHistoryService } from './patient-history.service';
import { PatientController } from './patient.controller';
import { EmployeeModule } from '../employee/employee.module';
import { OpdModule } from '../opd/opd.module';
import { BillingModule } from '../billing/billing.module';
import { BenefitModule } from '../benefit/benefit.module';

@Module({
  imports: [EmployeeModule, OpdModule, BillingModule, BenefitModule],
  controllers: [PatientController],
  providers: [PatientService, PatientHistoryService],
  exports: [PatientService, PatientHistoryService],
})
export class PatientModule {}
