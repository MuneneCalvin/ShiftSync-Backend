import 'dotenv/config';
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LocationsModule } from './locations/locations.module';
import { AvailabilityModule } from './availability/availability.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    AvailabilityModule,
  ],
})
export class AppModule {}
