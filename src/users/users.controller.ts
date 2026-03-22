import {
  Controller, Get, Patch, Post, Delete, Param, Body,
  UseGuards, ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.usersService.findOne(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: any,
  ) {
    if (currentUser.role === Role.STAFF && currentUser.id !== id) {
      throw new ForbiddenException();
    }
    return this.usersService.update(id, dto);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post(':id/skills')
  addSkill(@Param('id') id: string, @Body('skill') skill: string) {
    return this.usersService.addSkill(id, skill);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id/skills/:skill')
  removeSkill(@Param('id') id: string, @Param('skill') skill: string) {
    return this.usersService.removeSkill(id, skill);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post(':id/certifications')
  addCertification(@Param('id') id: string, @Body('locationId') locationId: string) {
    return this.usersService.addCertification(id, locationId);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id/certifications/:locationId')
  removeCertification(@Param('id') id: string, @Param('locationId') locationId: string) {
    return this.usersService.removeCertification(id, locationId);
  }
}
