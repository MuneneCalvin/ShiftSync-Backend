import { Module } from '@nestjs/common';
import { ConstraintEngineService } from './constraint-engine.service';

@Module({
  providers: [ConstraintEngineService],
  exports: [ConstraintEngineService],
})
export class ConstraintEngineModule {}
