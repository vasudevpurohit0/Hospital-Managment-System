import { IsNotEmpty, IsString } from 'class-validator';

export class TransferOpdVisitDto {
  @IsString()
  @IsNotEmpty()
  doctorId!: string;

  /** Required -- a queue reassignment must always be explained. */
  @IsString()
  @IsNotEmpty({ message: 'A reason is required to reassign a patient.' })
  reason!: string;
}
