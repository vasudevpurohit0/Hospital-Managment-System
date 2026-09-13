import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class TransferBedDto {
  // Plain string, matching AllocateBedDto's bedId: several seeded beds carry
  // hand-assigned demo ids (e.g. "00000000-0000-0000-0000-000000000302")
  // whose version nibble isn't RFC 4122-compliant, so @IsUUID() rejects them.
  @IsString()
  @IsNotEmpty()
  toBedId!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}
