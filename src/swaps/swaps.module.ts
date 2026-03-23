import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SwapsController } from './swaps.controller';
import { SwapsService } from './swaps.service';
import { SwapsScheduler } from './swaps.scheduler';
import { ConstraintEngineModule } from '../constraint-engine/constraint-engine.module';

@Module({
  imports: [ScheduleModule.forRoot(), ConstraintEngineModule],
  controllers: [SwapsController],
  providers: [SwapsService, SwapsScheduler],
  exports: [SwapsService],
})
export class SwapsModule {}
