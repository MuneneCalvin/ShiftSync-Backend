import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Get()
  async findAll(
    @Query('locationId') locationId: string,
    @Query('weekOf') weekOf: string,
    @CurrentUser() user: any,
  ) {
    // Managers can only query their assigned locations
    if (user?.role === Role.MANAGER && locationId) {
      await this.shiftsService.assertManagerOwnsLocation(locationId, user.id);
    }
    return this.shiftsService.findByLocationAndWeek(locationId, weekOf);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Get(':id/check')
  checkConstraints(
    @Param('id') shiftId: string,
    @Query('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.shiftsService.checkConstraints(shiftId, userId, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateShiftDto, @CurrentUser() user: any) {
    return this.shiftsService.create(dto, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateShiftDto>, @CurrentUser() user: any) {
    return this.shiftsService.update(id, dto, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() user: any) {
    return this.shiftsService.publish(id, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/unpublish')
  unpublish(@Param('id') id: string, @CurrentUser() user: any) {
    return this.shiftsService.unpublish(id, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post(':id/assign')
  assign(
    @Param('id') shiftId: string,
    @Body() dto: AssignShiftDto,
    @CurrentUser() user: any,
  ) {
    return this.shiftsService.assign(shiftId, dto, user.id);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id/assign/:userId')
  unassign(
    @Param('id') shiftId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.shiftsService.unassign(shiftId, userId, user.id);
  }
}
