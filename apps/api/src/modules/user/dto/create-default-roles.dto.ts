import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { STAFF_ROLE_NAMES } from './staff-role.const';

/**
 * Every role "Create Roles Automatically" can provision. All seeded staff
 * roles except Administrator (the requesting admin already holds it --
 * bulk-minting a second admin behind a shared initial password would be a
 * privilege-escalation footgun), plus Doctor, which is created through the
 * dedicated DoctorService (it needs a DoctorProfile row the generic staff
 * path never creates).
 */
export const DEFAULT_BULK_ROLES = [...STAFF_ROLE_NAMES.filter((r) => r !== 'Administrator'), 'Doctor'] as const;

export type DefaultBulkRole = (typeof DEFAULT_BULK_ROLES)[number];

export class CreateDefaultRolesDto {
  /**
   * ONE initial password for every account created by this operation. Same
   * minimum-length policy as password change (MinLength 8); capped at 72
   * chars because bcryptjs silently truncates beyond 72 bytes, which would
   * otherwise weaken long passwords without telling anyone. It is hashed
   * independently per account (bcrypt salts differ) and never stored,
   * returned, or logged -- see StaffService.createDefaultRoleAccounts.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Initial password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Initial password must be at most 72 characters.' })
  initialPassword!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;

  /** Subset of DEFAULT_BULK_ROLES to create. Omitted/empty means all of them. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  /** Force a personal password change on first login. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  requirePasswordChange?: boolean;
}
