import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';

@Injectable()
export class QrCodeService {
  private readonly logger = new Logger(QrCodeService.name);

  /**
   * Generates a scannable Base64 PNG Data URL encoding the payload string (e.g. UID code)
   * @param payload Content to encode in the QR code
   */
  async generateQrDataUrl(payload: string): Promise<string> {
    try {
      return await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 2,
        width: 300,
        color: {
          dark: '#1e3a8a', // ESIC primary dark blue
          light: '#ffffff',
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to generate QR code: ${message}`);
      throw new InternalServerErrorException('Failed to generate QR code. Please try again.');
    }
  }
}
