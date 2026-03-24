import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    const managerFilter = user?.role === Role.MANAGER ? user.id : undefined;
    return this.locationsService.findAll(managerFilter);
  }

  @Get(':id/on-duty')
  getOnDuty(@Param('id') id: string) {
    return this.locationsService.getOnDuty(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locationsService.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateLocationDto>) {
    return this.locationsService.update(id, dto);
  }
}
