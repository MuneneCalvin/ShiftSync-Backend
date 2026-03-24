import 'dotenv/config';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LocationsModule } from './locations/locations.module';
import { AvailabilityModule } from './availability/availability.module';
import { ConstraintEngineModule } from './constraint-engine/constraint-engine.module';
import { ShiftsModule } from './shifts/shifts.module';
import { SwapsModule } from './swaps/swaps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GatewayModule } from './gateway/gateway.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    AvailabilityModule,
    ConstraintEngineModule,
    ShiftsModule,
    SwapsModule,
    NotificationsModule,
    GatewayModule,
    AnalyticsModule,
    AuditLogsModule,
  ],
})
export class AppModule {}
