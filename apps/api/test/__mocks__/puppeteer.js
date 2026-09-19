// e2e-test stand-in for the real `puppeteer` package.
//
// `puppeteer@25.9.0` ships as ESM-only, which crashes ts-jest's CommonJS
// transform the moment anything imports it -- and every e2e spec transitively
// does, via AppModule -> RenderingModule -> DocumentRenderService's top-level
// `import puppeteer from 'puppeteer'`. DocumentRenderService only calls
// `puppeteer.launch()` lazily inside a PDF-rendering request, which no
// existing e2e spec exercises, so a minimal stub that fails loudly if ever
// actually invoked is safe: it unblocks every other e2e spec without a real
// Chromium dependency in the test environment.
module.exports = {
  launch: async () => {
    throw new Error(
      'puppeteer is mocked out in the e2e test environment (test/__mocks__/puppeteer.js) and cannot render PDFs here.',
    );
  },
};
