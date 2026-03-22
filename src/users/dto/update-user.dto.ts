import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  desiredHoursPerWeek?: number;
}
