import { Controller, Get, Put, Body, UseGuards, Req, OnModuleInit } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

const DEFAULT_BRANDING = {
  hospitalName: 'ESIC Model Hospital & ODC',
  tagline: 'Chinta Se Mukti • Dedicated to Healthcare Excellence',
  primaryColor: '#005691',
  logoUrl: 'https://www.esic.gov.in/assets/images/logo.png',
};

@Controller(['branding', 'config/branding'])
export class BrandingController implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Seed default branding if not exists
    await this.prisma.brandingConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...DEFAULT_BRANDING },
      update: {},
    });
  }

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
