import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { HospitalBranding } from './pdf-templates.types';

/**
 * Renders an HTML document to PDF, sharing one headless Chromium instance
 * across requests rather than launching a fresh process per document — the
 * per-launch cost (~1-2s) would otherwise land on every receipt and report.
 *
 * This is the one place that turns a printable HTML template into a PDF, for
 * receipts, lab reports, and the admin report centre alike — so a template
 * only has to be written once and works both on screen (the browser print
 * path already in use) and as a downloadable file.
 */
@Injectable()
export class DocumentRenderService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentRenderService.name);
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Every printed document's header comes from here — never a hardcoded hospital identity (plan §07/C7). */
  async getBranding(): Promise<HospitalBranding> {
    const config = await this.prisma.brandingConfig.findUnique({ where: { id: 'singleton' } });
    return {
      hospitalName: config?.hospitalName ?? 'ESIC Model Hospital & ODC',
      tagline: config?.tagline ?? '',
      primaryColor: config?.primaryColor ?? '#005691',
    };
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer
        .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
        .then((browser) => {
          browser.on('disconnected', () => {
            this.browserPromise = null; // let the next call relaunch
          });
          return browser;
        });
    }
    return this.browserPromise;
  }

  async renderPdf(html: string, options?: { landscape?: boolean }): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // No external resources are loaded (all styling is inlined in the
      // template), so 'load' is sufficient — networkidle0 isn't a valid
      // waitUntil option for setContent (only for page.goto).
      await page.setContent(html, { waitUntil: 'load' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        landscape: options?.landscape ?? false,
        margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      });
      return Buffer.from(buffer);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      try {
        const browser = await this.browserPromise;
        await browser.close();
      } catch (err) {
        this.logger.warn(`Error closing Puppeteer browser: ${err}`);
      }
    }
  }
}
