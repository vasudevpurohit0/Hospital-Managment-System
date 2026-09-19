import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePrescriptionItemDto } from './create-prescription-item.dto';

/**
 * A DRAFT prescription's only editable content: its medicine items. Diagnosis
 * fields (symptoms/diagnosisText/etc.) live on the separate Diagnosis record
 * created alongside the prescription and are not editable through this
 * endpoint -- a real class (not `Partial<CreatePrescriptionDto>`) both makes
 * that boundary explicit and lets the global ValidationPipe actually validate
 * the body, which the previous `Partial<>` type (erased to `Object` at
 * runtime) silently skipped.
 */
export class UpdatePrescriptionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items!: CreatePrescriptionItemDto[];
}
