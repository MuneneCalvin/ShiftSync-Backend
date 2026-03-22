import 'dotenv/config';
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LocationsModule } from './locations/locations.module';
import { AvailabilityModule } from './availability/availability.module';
import { ConstraintEngineModule } from './constraint-engine/constraint-engine.module';
import { ShiftsModule } from './shifts/shifts.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    AvailabilityModule,
    ConstraintEngineModule,
    ShiftsModule,
  ],
})
export class AppModule {}
