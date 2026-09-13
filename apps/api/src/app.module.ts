import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { SequenceModule } from './common/sequence/sequence.module';
import { RenderingModule } from './common/rendering/rendering.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { FacilityModule } from './modules/facility/facility.module';
import { BenefitModule } from './modules/benefit/benefit.module';
import { PrescriptionModule } from './modules/prescription/prescription.module';
import { VisitModule } from './modules/visit/visit.module';
import { OpdModule } from './modules/opd/opd.module';
import { AdmissionModule } from './modules/admission/admission.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { LaboratoryModule } from './modules/laboratory/laboratory.module';
import { TherapyModule } from './modules/therapy/therapy.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { UserModule } from './modules/user/user.module';
import { PatientModule } from './modules/patient/patient.module';
import { RbacAdminModule } from './modules/rbac-admin/rbac-admin.module';
import { BrandingController } from './modules/auth/branding.controller';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SecurityMiddleware } from './common/middleware/security.middleware';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    SequenceModule,
    RenderingModule,
    HealthModule,
    AuthModule,
    EmployeeModule,
    PatientModule,
    FacilityModule,
    BenefitModule,
    PrescriptionModule,
    VisitModule,
    OpdModule,
    AdmissionModule,
    PharmacyModule,
    InventoryModule,
    ProcurementModule,
    BillingModule,
    CatalogModule,
    LaboratoryModule,
    TherapyModule,
    AnalyticsModule,
    ReportsModule,
    DashboardModule,
    UserModule,
    RbacAdminModule,
  ],
  controllers: [BrandingController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
