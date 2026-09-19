import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

describe('EmailService', () => {
  const mockPrisma = {
    emailLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  describe('dev-outbox fallback (no SMTP_HOST configured)', () => {
    beforeEach(() => {
      delete process.env.SMTP_HOST;
    });

    it('never throws, and logs an EmailLog row with status DEV_LOGGED', async () => {
      const service = new EmailService(mockPrisma as never);
      await expect(
        service.sendMail({ to: 'nurse@esic.gov.in', subject: 'Test', html: '<p>hi</p>', text: 'hi', kind: 'ACTIVATION' }),
      ).resolves.toBeUndefined();

      expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ toEmail: 'nurse@esic.gov.in', status: 'DEV_LOGGED', kind: 'ACTIVATION' }),
      });
    });

    it('never persists the email body, only metadata', async () => {
      const service = new EmailService(mockPrisma as never);
      await service.sendMail({
        to: 'nurse@esic.gov.in',
        subject: 'Test',
        html: '<p>secret-password-value</p>',
        text: 'secret-password-value',
        kind: 'TEMP_PASSWORD',
      });

      const dataArg = mockPrisma.emailLog.create.mock.calls[0][0].data;
      expect(JSON.stringify(dataArg)).not.toContain('secret-password-value');
    });
  });

  describe('real SMTP delivery (SMTP_HOST configured)', () => {
    let sendMailMock: jest.Mock;

    beforeEach(() => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      sendMailMock = jest.fn().mockResolvedValue({ messageId: 'abc' });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: sendMailMock });
    });

    it('sends via the real transport and logs status SENT', async () => {
      const service = new EmailService(mockPrisma as never);
      await service.sendMail({ to: 'nurse@esic.gov.in', subject: 'Test', html: '<p>hi</p>', text: 'hi', kind: 'ACTIVATION' });

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'nurse@esic.gov.in', subject: 'Test' }),
      );
      expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'SENT' }),
      });
    });

    it('never throws on transport failure -- logs status FAILED with the error message instead', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('connection refused'));
      const service = new EmailService(mockPrisma as never);

      await expect(
        service.sendMail({ to: 'nurse@esic.gov.in', subject: 'Test', html: '<p>hi</p>', text: 'hi', kind: 'ACTIVATION' }),
      ).resolves.toBeUndefined();

      expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'connection refused' }),
      });
    });
  });
});
