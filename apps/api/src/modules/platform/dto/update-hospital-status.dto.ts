import { IsIn } from 'class-validator';

export class UpdateHospitalStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';
}
