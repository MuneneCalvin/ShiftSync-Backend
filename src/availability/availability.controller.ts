import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';

@UseGuards(JwtAuthGuard)
@Controller('availability')
export class AvailabilityController {
  constructor(private availabilityService: AvailabilityService) {}

  @Get('me')
  getMyAvailability(@CurrentUser() user: any) {
    return this.availabilityService.findByUser(user.id);
  }

  @Get('user/:userId')
  getUserAvailability(@Param('userId') userId: string) {
    return this.availabilityService.findByUser(userId);
  }

  @Post('me')
  addAvailability(@CurrentUser() user: any, @Body() dto: UpsertAvailabilityDto) {
    return this.availabilityService.upsert(user.id, dto);
  }

  @Delete(':id')
  removeAvailability(@Param('id') id: string) {
    return this.availabilityService.remove(id);
  }
}
