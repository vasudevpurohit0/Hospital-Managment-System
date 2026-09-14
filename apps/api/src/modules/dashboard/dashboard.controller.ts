import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Dashboard summary is hospital-wide aggregate counts (visits, beds, stock,
 * requisitions, charges) — it never reads an individual Employee record, so
 * it must not gate on Employee:read. Every role with "Dashboard" in its
 * sidebar (including StoreManager and ProcurementOfficer, who hold no
 * Employee permission) needs this to load; JwtAuthGuard alone is the correct
 * bar, matching what is actually queried.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async getMetrics() {
    return this.dashboardService.getMetrics();
  }
}
