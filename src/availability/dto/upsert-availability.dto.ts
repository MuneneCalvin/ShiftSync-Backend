import { IsEnum, IsOptional, IsInt, Min, Max, IsString, IsBoolean, IsDateString } from 'class-validator';
import { AvailabilityType } from '@prisma/client';

export class UpsertAvailabilityDto {
  @IsEnum(AvailabilityType)
  type: AvailabilityType;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}
