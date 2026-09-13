import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export const BILLING_TYPES = ['GENERAL', 'ESIC_BENEFICIARY'] as const;
export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'NOT_APPLICABLE'] as const;

/** Manually posts a catalogue service charge against a visit. */
export class PostServiceChargeDto {
  @IsUUID()
  visitId!: string;

  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  // No discountAmount: this system has no discount. A charge is always
  // quantity × the configured service rate — see ChargeService.
}

export class CancelChargeDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class IssueReceiptDto {
  @IsUUID(undefined, { each: true })
  chargeIds!: string[];

  @IsOptional()
  @IsIn(PAYMENT_MODES)
  paymentMode?: (typeof PAYMENT_MODES)[number];

  @IsOptional()
  @IsIn(BILLING_TYPES)
  billingType?: (typeof BILLING_TYPES)[number];
}
