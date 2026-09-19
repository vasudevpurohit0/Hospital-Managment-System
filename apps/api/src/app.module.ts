import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { SequenceModule } from './common/sequence/sequence.module';
import { EmailModule } from './common/email/email.module';
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
import { PlatformModule } from './modules/platform/platform.module';
import { AuditLogModule } from './modules/audit/audit-log.module';
import { BrandingController } from './modules/auth/branding.controller';
import { HospitalSettingsController } from './modules/auth/hospital-settings.controller';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // V-04: a single named profile applied to every route by the global
    // ThrottlerGuard below. Individual controllers override its limit
    // per-route with `@Throttle({ default: { limit, ttl } })` for endpoints
    // that need a tighter ceiling (login, password-reset, report/PDF
    // generation) -- registering more than one named profile here would
    // apply ALL of them to EVERY route simultaneously (that's how
    // @nestjs/throttler's multi-profile support works), which is not what a
    // per-route override needs.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    TenantModule,
    PrismaModule,
    SequenceModule,
    EmailModule,
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
    PlatformModule,
    AuditLogModule,
  ],
  controllers: [BrandingController, HospitalSettingsController],
  providers: [
    // Runs before the auth/RBAC guards below -- an unauthenticated
    // brute-force attempt against /auth/login should be throttled before any
    // auth logic even runs, not after.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
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
    // TenantResolutionMiddleware must run before the guard chain (JwtAuthGuard
    // reloads the user from the tenant DB during Passport validation), so it
    // is applied first here.
    consumer.apply(TenantResolutionMiddleware, SecurityMiddleware).forRoutes('*');
  }
}
