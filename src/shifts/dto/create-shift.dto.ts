import { IsString, IsNotEmpty, IsInt, Min, IsDateString, IsBoolean, IsOptional } from 'class-validator';

export class CreateShiftDto {
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsString()
  @IsNotEmpty()
  requiredSkill: string;

  @IsInt()
  @Min(1)
  headcount: number;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isOvernight?: boolean;

  @IsDateString()
  weekOf: string;
}
