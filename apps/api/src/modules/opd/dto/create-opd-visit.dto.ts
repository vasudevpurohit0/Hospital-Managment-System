import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateOpdVisitDto {
  @IsUUID()
  @IsNotEmpty()
  visitId!: string;

  @IsUUID()
  @IsNotEmpty()
  departmentId!: string;

  /** Validated against DoctorService's eligibility rule (active, Doctor role, has a profile, belongs to this department) before the visit is created. */
  @IsUUID()
  @IsNotEmpty()
  doctorId!: string;
}
