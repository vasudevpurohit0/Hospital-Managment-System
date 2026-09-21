import puppeteer from 'puppeteer';
import { DocumentRenderService } from './document-render.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));

describe('DocumentRenderService', () => {
  const mockPrisma = {
    brandingConfig: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  let service: DocumentRenderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentRenderService(mockPrisma);
  });

  const fakePage = () => ({
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    close: jest.fn().mockResolvedValue(undefined),
  });

  const fakeBrowser = () => ({
    on: jest.fn(),
    newPage: jest.fn().mockResolvedValue(fakePage()),
    close: jest.fn().mockResolvedValue(undefined),
  });

  it('renders a PDF via a successfully launched browser', async () => {
    (puppeteer.launch as jest.Mock).mockResolvedValue(fakeBrowser());
    const buffer = await service.renderPdf('<html></html>');
    expect(buffer.toString()).toContain('%PDF-fake');
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  it('reuses the same browser across multiple renders (no relaunch per request)', async () => {
    (puppeteer.launch as jest.Mock).mockResolvedValue(fakeBrowser());
    await service.renderPdf('<html>one</html>');
    await service.renderPdf('<html>two</html>');
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  // Regression: a failed launch used to be cached forever. `!rejectedPromise`
  // is `false` (a promise object is truthy regardless of its settled state),
  // so the old `if (!this.browserPromise)` guard treated a permanently-
  // rejected launch attempt as "already have a browser" and never retried --
  // every request after the first failure got stuck replaying the exact same
  // rejection, even once the underlying cause (e.g. a missing system
  // dependency) was fixed live, until the whole process was restarted.
  it('retries launching the browser after a failed attempt, instead of caching the rejection forever', async () => {
    (puppeteer.launch as jest.Mock)
      .mockRejectedValueOnce(new Error('Could not find Chrome'))
      .mockResolvedValueOnce(fakeBrowser());

    await expect(service.renderPdf('<html></html>')).rejects.toThrow('Could not find Chrome');

    const buffer = await service.renderPdf('<html></html>');
    expect(buffer.toString()).toContain('%PDF-fake');
    expect(puppeteer.launch).toHaveBeenCalledTimes(2);
  });

  it('relaunches after the browser disconnects', async () => {
    const browser1 = fakeBrowser();
    const browser2 = fakeBrowser();
    (puppeteer.launch as jest.Mock).mockResolvedValueOnce(browser1).mockResolvedValueOnce(browser2);

    await service.renderPdf('<html></html>');
    const disconnectedHandler = browser1.on.mock.calls.find((c) => c[0] === 'disconnected')?.[1];
    disconnectedHandler?.();

    await service.renderPdf('<html></html>');
    expect(puppeteer.launch).toHaveBeenCalledTimes(2);
  });
});
