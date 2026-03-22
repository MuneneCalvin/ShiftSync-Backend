import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { ConstraintEngineModule } from '../constraint-engine/constraint-engine.module';

@Module({
  imports: [ConstraintEngineModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
