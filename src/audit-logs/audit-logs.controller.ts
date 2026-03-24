import { Controller, Get, Query, UseGuards, ParseIntPipe, DefaultValuePipe, Optional } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogsService } from './audit-logs.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private auditLogsService: AuditLogsService) {}

  @Get()
  findAll(
    @Query('shiftId') shiftId?: string,
    @Query('swapId') swapId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('locationId') locationId?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.auditLogsService.findAll({ shiftId, swapId, actorId, action, locationId, limit, offset });
  }
}
