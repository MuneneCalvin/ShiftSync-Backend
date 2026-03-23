import { IsEnum, IsString, IsOptional } from 'class-validator';
import { SwapType } from '@prisma/client';

export class CreateSwapDto {
  @IsEnum(SwapType)
  type: SwapType;

  @IsString()
  shiftId: string;

  @IsOptional()
  @IsString()
  targetUserId?: string; // required for SWAP, null for DROP
}
