import { IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

/**
 * V-16: `PUT /branding` used to be typed `@Body() body: any`, so the global
 * ValidationPipe's `whitelist`/`forbidNonWhitelisted` had nothing to
 * validate against and silently let any value through -- including a
 * `primaryColor` value crafted to break out of the `<style>` block it gets
 * interpolated into in `pdf-templates.ts` (a shared, long-lived Puppeteer
 * instance used for every tenant's receipts/reports). `@Matches` restricts
 * `primaryColor` to a real 6-digit hex color, the only shape that render
 * site actually needs.
 */
export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hospitalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tagline?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a 6-digit hex color, e.g. #005691' })
  primaryColor?: string;

  @IsOptional()
  @IsUrl({}, { message: 'logoUrl must be a valid URL' })
  @MaxLength(2000)
  logoUrl?: string;
}
