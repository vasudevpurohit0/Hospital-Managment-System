import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOpdVisitDto {
  @IsString()
  @IsNotEmpty()
  visitId!: string;

  @IsString()
  @IsNotEmpty()
  departmentId!: string;

  /** Validated against DoctorService's eligibility rule (active, Doctor role, has a profile, belongs to this department) before the visit is created. */
  @IsString()
  @IsNotEmpty()
  doctorId!: string;
}
