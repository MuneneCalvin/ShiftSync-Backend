import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AssignShiftDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  overrideOvertimeReason?: string;
}
