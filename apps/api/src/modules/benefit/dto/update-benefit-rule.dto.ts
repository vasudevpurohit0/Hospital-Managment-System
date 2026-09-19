import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { BenefitOutcome } from '@prisma/client';

/**
 * V-20: the controller previously typed this body as `Partial<CreateBenefitRuleDto>`
 * -- a TypeScript-only type that erases to `Object` at runtime, so the global
 * ValidationPipe's `whitelist`/`forbidNonWhitelisted` had no decorators to
 * enforce and let any field through unvalidated. A real class with its own
 * `@IsOptional()` validators closes that gap the same way UpdatePatientProfileDto
 * and UpdateBrandingDto already do elsewhere in this codebase.
 */
export class UpdateBenefitRuleDto {
  @IsOptional()
  @IsString()
  medicineCategory?: string;

  @IsOptional()
  @IsEnum(BenefitOutcome)
  outcome?: BenefitOutcome;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
