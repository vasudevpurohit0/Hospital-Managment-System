import { resolveCorsOrigins } from './cors.util';

describe('resolveCorsOrigins()', () => {
  const originalCorsOrigins = process.env.CORS_ORIGINS;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.CORS_ORIGINS = originalCorsOrigins;
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('defaults to the local dev frontend origin when nothing is configured', () => {
    delete process.env.CORS_ORIGINS;
    delete process.env.FRONTEND_URL;
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('falls back to FRONTEND_URL when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    process.env.FRONTEND_URL = 'https://hms.example.gov.in';
    expect(resolveCorsOrigins()).toEqual(['https://hms.example.gov.in']);
  });

  it('parses a comma-separated CORS_ORIGINS into a trimmed list', () => {
    process.env.CORS_ORIGINS = ' https://hms.example.gov.in , https://staging.hms.example.gov.in ';
    expect(resolveCorsOrigins()).toEqual(['https://hms.example.gov.in', 'https://staging.hms.example.gov.in']);
  });

  it('ignores an empty CORS_ORIGINS value and falls back to the default', () => {
    process.env.CORS_ORIGINS = '   ';
    delete process.env.FRONTEND_URL;
    expect(resolveCorsOrigins()).toEqual(['http://localhost:5173']);
  });
});
