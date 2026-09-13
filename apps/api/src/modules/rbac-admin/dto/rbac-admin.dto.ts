import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class GrantPermissionDto {
  @IsUUID()
  roleId!: string;

  @IsString()
  @IsNotEmpty()
  resource!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;
}
