import { describe, it, expect } from 'vitest';
import { pageIdFromPath, pathForPageId } from '../components/layout/AppShell';
import type { PageId } from '../components/layout/Sidebar';

/**
 * Introducing the router must not change which screen any existing navigation
 * target lands on. These lock the PageId ↔ URL mapping so a rename cannot
 * silently break a bookmark or the sidebar.
 */
describe('AppShell routing', () => {
  const EXISTING_PAGES: PageId[] = [
    'dashboard',
    'patient-search',
    'patient-records',
    'registration',
    'opd-queue',
    'consultations',
    'doctor-schedule',
    'ipd-admissions',
    'ward-console',
    'pharmacy',
    'inventory',
    'expiry-fefo',
    'supply-chain',
    'billing',
    'patient-ledger',
    'facility-rules',
    'service-pricing',
    'analytics',
    'system-config',
  ];

  it('round-trips every existing page through its URL', () => {
    for (const page of EXISTING_PAGES) {
      expect(pageIdFromPath(pathForPageId(page), 'dashboard')).toBe(page);
    }
  });

  it('maps a page to a stable, readable path', () => {
    expect(pathForPageId('opd-queue')).toBe('/opd-queue');
    expect(pathForPageId('dashboard')).toBe('/dashboard');
  });

  it('falls back for the site root so a bare visit lands somewhere valid', () => {
    expect(pageIdFromPath('/', 'dashboard')).toBe('dashboard');
    expect(pageIdFromPath('/', 'opd-queue')).toBe('opd-queue');
  });

  it('falls back for an unrecognised path rather than rendering nothing', () => {
    expect(pageIdFromPath('/not-a-real-page', 'dashboard')).toBe('dashboard');
  });

  it('ignores trailing segments so nested detail routes resolve to their screen', () => {
    expect(pageIdFromPath('/billing/RCPT-2026-000001', 'dashboard')).toBe('billing');
    expect(pageIdFromPath('/patient-records/ESIC-2026-000001', 'dashboard')).toBe(
      'patient-records',
    );
  });

  it('tolerates duplicated leading slashes', () => {
    expect(pageIdFromPath('//inventory', 'dashboard')).toBe('inventory');
  });
});
