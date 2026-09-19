import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  sentByUserId?: string;
}

/**
 * Real SMTP delivery when SMTP_HOST is configured; a safe dev-outbox
 * fallback otherwise (logs the email, including any link, at debug level,
 * and records it as DEV_LOGGED) -- never throws either way, since a failed
 * or unconfigured email send must never block or roll back the account
 * action that triggered it. EmailLog is always written, and only ever
 * records metadata (recipient/subject/kind/status) -- never the email body,
 * a token, or a password.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private warnedNoSmtp = false;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    if (!this.transporter) {
      if (!this.warnedNoSmtp) {
        this.logger.warn(
          'SMTP_HOST is not configured -- emails will be logged (dev-outbox) instead of actually sent. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM to enable real delivery.',
        );
        this.warnedNoSmtp = true;
      }
      this.logger.debug(`[dev-outbox] To: ${options.to} | Subject: ${options.subject}\n${options.text}`);
      await this.prisma.emailLog
        .create({
          data: { toEmail: options.to, subject: options.subject, kind: options.kind, status: 'DEV_LOGGED', sentByUserId: options.sentByUserId },
        })
        .catch(() => undefined);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@hospital.local',
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      await this.prisma.emailLog
        .create({ data: { toEmail: options.to, subject: options.subject, kind: options.kind, status: 'SENT', sentByUserId: options.sentByUserId } })
        .catch(() => undefined);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${options.to}: ${message}`);
      await this.prisma.emailLog
        .create({
          data: {
            toEmail: options.to,
            subject: options.subject,
            kind: options.kind,
            status: 'FAILED',
            sentByUserId: options.sentByUserId,
            errorMessage: message,
          },
        })
        .catch(() => undefined);
    }
  }
}
