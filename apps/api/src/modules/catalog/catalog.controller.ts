import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';
import {
  CreateServiceDto,
  ServiceQueryDto,
  SetPackageComponentsDto,
  SetPriceDto,
  UpdateServiceDto,
} from './dto/service.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { toTenantActorUserId } from '../../common/audit/audit-actor.util';

/**
 * Service catalogue and pricing administration.
 *
 * Reading the catalogue is available to any role that needs to order a service
 * (Service:read). Changing a rate is a separate permission (ServicePrice:create)
 * held only by Administrator and SuperAdmin, so an operational role can bill a
 * service without being able to decide what it costs.
 */
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
  ) {}

  @Get('categories')
  @RequirePermission('Service', 'read')
  async listCategories() {
    return this.catalog.listCategories();
  }

  @Get('services')
  @RequirePermission('Service', 'read')
  async listServices(@Query() query: ServiceQueryDto) {
    return this.catalog.listServices(query);
  }

  /** Services that are active but have no rate — the go-live review list. */
  @Get('services/unpriced')
  @RequirePermission('Service', 'read')
  async unpriced() {
    return this.pricing.unpricedServices();
  }

  @Get('services/:id')
  @RequirePermission('Service', 'read')
  async getService(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getService(id);
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Service', 'create')
  async createService(@Body() dto: CreateServiceDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.catalog.createService(dto, user?.id);
  }

  @Patch('services/:id')
  @RequirePermission('Service', 'update')
  async updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.catalog.updateService(id, dto, user?.id);
  }

  @Patch('services/:id/components')
  @RequirePermission('Service', 'update')
  async setComponents(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPackageComponentsDto,
  ) {
    return this.catalog.setPackageComponents(id, dto.components);
  }

  /** Current rate effective now, or at `at` when supplied. */
  @Get('services/:id/price')
  @RequirePermission('Service', 'read')
  async currentPrice(@Param('id', ParseUUIDPipe) id: string, @Query('at') at?: string) {
    const resolved = await this.pricing.resolve(id, at ? new Date(at) : new Date());
    return { ...resolved, amount: resolved.amount.toString() };
  }

  @Get('services/:id/price-history')
  @RequirePermission('ServicePrice', 'read')
  async priceHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.history(id);
  }

  /**
   * Supersedes the current rate with a new version. Never overwrites: the
   * previous version is closed and retained so issued bills keep resolving it.
   */
  @Post('services/:id/prices')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ServicePrice', 'create')
  async setPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriceDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const result = await this.pricing.setPrice({
      serviceId: id,
      amount: dto.amount,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      reason: dto.reason,
      actorUserId: toTenantActorUserId(user),
      actorRole: user?.roleName,
    });

    return {
      previous: result.previous,
      current: { ...result.current, amount: result.current.amount.toString() },
    };
  }
}
