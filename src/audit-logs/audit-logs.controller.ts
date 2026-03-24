import { Controller, Get, Query, UseGuards, ParseIntPipe, DefaultValuePipe, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogsService } from './audit-logs.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private auditLogsService: AuditLogsService) {}

  @Get('export')
  @Roles(Role.ADMIN)
  async exportCsv(
    @Query('locationId') locationId?: string,
    @Query('action') action?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.auditLogsService.exportCsv({ locationId, action, startDate, endDate });
    const filename = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    res!.setHeader('Content-Type', 'text/csv');
    res!.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res!.send(csv);
  }

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
