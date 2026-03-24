import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { Role, SwapStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SwapsService } from './swaps.service';
import { CreateSwapDto } from './dto/create-swap.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('swaps')
export class SwapsController {
  constructor(private swapsService: SwapsService) {}

  @Get()
  findAll(
    @Query('requesterId') requesterId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: SwapStatus,
    @CurrentUser() user?: any,
  ) {
    const filters: { requesterId?: string; locationId?: string; status?: SwapStatus; managerId?: string } = { status };
    if (user?.role === Role.STAFF) {
      // Staff see only their own swaps
      filters.requesterId = user.id;
    } else if (user?.role === Role.MANAGER) {
      // Managers are scoped to their assigned locations (resolved in service via ManagerLocation)
      filters.managerId = user.id;
      if (requesterId) filters.requesterId = requesterId;
    } else {
      // Admin: no location restriction
      if (locationId) filters.locationId = locationId;
      if (requesterId) filters.requesterId = requesterId;
    }
    return this.swapsService.findAll(filters);
  }

  @Get('open-drops')
  findOpenDrops(@CurrentUser() user: any) {
    return this.swapsService.findOpenDrops(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.swapsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSwapDto, @CurrentUser() user: any) {
    return this.swapsService.create(dto, user.id);
  }

  @Patch(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: any) {
    return this.swapsService.accept(id, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.swapsService.approve(id, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: any) {
    return this.swapsService.reject(id, user.id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.swapsService.cancel(id, user.id);
  }

  @Patch(':id/pickup')
  pickup(@Param('id') id: string, @CurrentUser() user: any) {
    return this.swapsService.pickup(id, user.id);
  }
}
