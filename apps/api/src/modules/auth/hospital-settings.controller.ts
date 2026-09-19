import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateHospitalSettingsDto } from './dto/update-hospital-settings.dto';

export const DEFAULT_HOSPITAL_SETTINGS = {
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  currency: 'INR',
  taxPercent: 0,
  billingPrefix: 'INV',
  notifyOnAdmission: true,
  notifyOnDischarge: true,
  notifyOnLowStock: true,
  sendTemporaryPasswordByEmail: false,
};

// The default settings singleton row is seeded per-tenant-schema by
// prisma/seed.ts (which imports DEFAULT_HOSPITAL_SETTINGS from here), the
// same way DEFAULT_BRANDING already is -- there is no single "the" database
// to seed into now that each hospital has its own schema, and each one gets
// its own independent HospitalSettings row.
//
// Unlike branding (public, shown on the login screen before any auth
// exists), these settings are operational configuration with no reason to be
// visible pre-login, so both GET and PUT sit behind real auth.
@Controller('settings/hospital')
@UseGuards(JwtAuthGuard)
export class HospitalSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('HospitalSettings', 'read')
  async getSettings() {
    return this.prisma.hospitalSettings.findUnique({ where: { id: 'singleton' } });
  }

  @Put()
  @RequirePermission('HospitalSettings', 'update')
  async updateSettings(@Body() body: UpdateHospitalSettingsDto, @Req() req: { user?: { sub?: string; id?: string } }) {
    const updated = await this.prisma.hospitalSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        workingHoursStart: body.workingHoursStart ?? DEFAULT_HOSPITAL_SETTINGS.workingHoursStart,
        workingHoursEnd: body.workingHoursEnd ?? DEFAULT_HOSPITAL_SETTINGS.workingHoursEnd,
        workingDays: body.workingDays ?? DEFAULT_HOSPITAL_SETTINGS.workingDays,
        currency: body.currency ?? DEFAULT_HOSPITAL_SETTINGS.currency,
        taxPercent: body.taxPercent ?? DEFAULT_HOSPITAL_SETTINGS.taxPercent,
        billingPrefix: body.billingPrefix ?? DEFAULT_HOSPITAL_SETTINGS.billingPrefix,
        notifyOnAdmission: body.notifyOnAdmission ?? DEFAULT_HOSPITAL_SETTINGS.notifyOnAdmission,
        notifyOnDischarge: body.notifyOnDischarge ?? DEFAULT_HOSPITAL_SETTINGS.notifyOnDischarge,
        notifyOnLowStock: body.notifyOnLowStock ?? DEFAULT_HOSPITAL_SETTINGS.notifyOnLowStock,
        sendTemporaryPasswordByEmail: body.sendTemporaryPasswordByEmail ?? DEFAULT_HOSPITAL_SETTINGS.sendTemporaryPasswordByEmail,
      },
      update: {
        ...(body.workingHoursStart !== undefined && { workingHoursStart: body.workingHoursStart }),
        ...(body.workingHoursEnd !== undefined && { workingHoursEnd: body.workingHoursEnd }),
        ...(body.workingDays !== undefined && { workingDays: body.workingDays }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.taxPercent !== undefined && { taxPercent: body.taxPercent }),
        ...(body.billingPrefix !== undefined && { billingPrefix: body.billingPrefix }),
        ...(body.notifyOnAdmission !== undefined && { notifyOnAdmission: body.notifyOnAdmission }),
        ...(body.notifyOnDischarge !== undefined && { notifyOnDischarge: body.notifyOnDischarge }),
        ...(body.notifyOnLowStock !== undefined && { notifyOnLowStock: body.notifyOnLowStock }),
        ...(body.sendTemporaryPasswordByEmail !== undefined && { sendTemporaryPasswordByEmail: body.sendTemporaryPasswordByEmail }),
      },
    });

    return {
      status: 'success',
      message: 'Hospital settings updated successfully',
      data: updated,
      updatedBy: req.user?.sub ?? req.user?.id ?? 'unknown',
    };
  }
}
