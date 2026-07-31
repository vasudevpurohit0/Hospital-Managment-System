import { IsNotEmpty, IsUUID } from 'class-validator';

export class AllocateBedDto {
  @IsUUID()
  @IsNotEmpty()
  bedId!: string;

  @IsUUID()
  @IsNotEmpty()
  assignedDoctorId!: string;

  @IsUUID()
  @IsNotEmpty()
  assignedNurseId!: string;
}
