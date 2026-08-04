import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AllocateBedDto {
  @IsString()
  @IsNotEmpty()
  bedId!: string;

  @IsString()
  @IsOptional()
  assignedDoctorId?: string;

  @IsString()
  @IsOptional()
  assignedNurseId?: string;
}
