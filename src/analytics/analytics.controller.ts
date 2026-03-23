import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overtime')
  getOvertimeReport(@Query('weeksBack') weeksBack?: string) {
    return this.analyticsService.getOvertimeReport(weeksBack ? parseInt(weeksBack) : 4);
  }

  @Get('fairness/:locationId')
  getFairnessReport(
    @Param('locationId') locationId: string,
    @Query('weeksBack') weeksBack?: string,
  ) {
    return this.analyticsService.getFairnessReport(
      locationId,
      weeksBack ? parseInt(weeksBack) : 6,
    );
  }

  @Get('hours-distribution/:locationId')
  getHoursDistribution(
    @Param('locationId') locationId: string,
    @Query('weeksBack') weeksBack?: string,
  ) {
    return this.analyticsService.getHoursDistribution(
      locationId,
      weeksBack ? parseInt(weeksBack) : 8,
    );
  }
}
