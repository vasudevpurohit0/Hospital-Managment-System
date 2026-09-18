import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

export const DEFAULT_BRANDING = {
  hospitalName: 'ESIC Model Hospital & ODC',
  tagline: 'Chinta Se Mukti • Dedicated to Healthcare Excellence',
  primaryColor: '#005691',
  logoUrl: 'https://www.esic.gov.in/assets/images/logo.png',
};

// The default branding singleton row is seeded per-tenant-schema by
// prisma/seed.ts (which imports DEFAULT_BRANDING from here), not at
// app-process boot -- there is no single "the" database to seed into anymore
// now that each hospital has its own schema (and its own BrandingConfig row,
// which is exactly the per-hospital branding this system will want).
@Controller(['branding', 'config/branding'])
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async getBranding() {
    return this.prisma.brandingConfig.findUnique({ where: { id: 'singleton' } });
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  @RequirePermission('BrandingConfig', 'update')
  async updateBranding(@Body() body: any, @Req() req: any) {
    const updated = await this.prisma.brandingConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        hospitalName: body.hospitalName ?? DEFAULT_BRANDING.hospitalName,
        tagline: body.tagline ?? DEFAULT_BRANDING.tagline,
        primaryColor: body.primaryColor ?? DEFAULT_BRANDING.primaryColor,
        logoUrl: body.logoUrl ?? DEFAULT_BRANDING.logoUrl,
      },
      update: {
        ...(body.hospitalName && { hospitalName: body.hospitalName }),
        ...(body.tagline && { tagline: body.tagline }),
        ...(body.primaryColor && { primaryColor: body.primaryColor }),
        ...(body.logoUrl && { logoUrl: body.logoUrl }),
      },
    });

    return {
      status: 'success',
      message: 'Branding configuration updated successfully',
      data: updated,
      updatedBy: req.user?.sub ?? req.user?.id ?? 'unknown',
    };
  }
}
