import { describe, it, expect } from 'vitest';
import { isPageAllowedForRole, getDefaultPageForRole, PAGE_ROLES, PageId } from '../components/layout/Sidebar';

/**
 * Regression coverage for the route-guard fix: before this, only the sidebar
 * LINK was hidden from a role that shouldn't see a screen -- the screen
 * itself still fully rendered if reached by direct URL, browser Back, a
 * stale bookmark, or the command palette. `isPageAllowedForRole` is the same
 * source of truth AppShell now uses to block that, so these tests lock the
 * exact behavior a role depends on.
 */

const ALL_PAGE_IDS = Object.keys(PAGE_ROLES) as PageId[];

describe('isPageAllowedForRole / getDefaultPageForRole', () => {
  it('every declared page allows SuperAdmin', () => {
    for (const pageId of ALL_PAGE_IDS) {
      expect(isPageAllowedForRole(pageId, 'SuperAdmin')).toBe(true);
    }
  });

  it('denies every page to an unauthenticated caller', () => {
    for (const pageId of ALL_PAGE_IDS) {
      expect(isPageAllowedForRole(pageId, undefined)).toBe(false);
      expect(isPageAllowedForRole(pageId, null)).toBe(false);
      expect(isPageAllowedForRole(pageId, '')).toBe(false);
    }
  });

  it('a single-purpose role (QueueManager) is confined to its one screen -- including being denied dashboard, not just missing its link', () => {
    expect(isPageAllowedForRole('opd-queue', 'QueueManager')).toBe(true);
    expect(isPageAllowedForRole('dashboard', 'QueueManager')).toBe(false);
    expect(isPageAllowedForRole('billing', 'QueueManager')).toBe(false);
    expect(isPageAllowedForRole('rbac-management', 'QueueManager')).toBe(false);
    expect(getDefaultPageForRole('QueueManager')).toBe('opd-queue');
  });

  it('LabTechnician/Pathologist are confined to Laboratory, not dashboard (regression: previously only QueueManager had this enforced at all)', () => {
    expect(isPageAllowedForRole('laboratory', 'LabTechnician')).toBe(true);
    expect(isPageAllowedForRole('dashboard', 'LabTechnician')).toBe(false);
    expect(isPageAllowedForRole('staff-management', 'LabTechnician')).toBe(false);
    expect(getDefaultPageForRole('LabTechnician')).toBe('laboratory');

    expect(isPageAllowedForRole('laboratory', 'Pathologist')).toBe(true);
    expect(isPageAllowedForRole('dashboard', 'Pathologist')).toBe(false);
    expect(getDefaultPageForRole('Pathologist')).toBe('laboratory');
  });

  it('admin-only screens reject non-admin roles (regression: previously reachable by direct URL for any authenticated role)', () => {
    const adminOnlyPages: PageId[] = [
      'rbac-management',
      'system-config',
      'staff-management',
      'analytics',
      'reports',
      'service-pricing',
      'facility-rules',
      'department-management',
      'activity-log',
    ];
    const nonAdminRoles = ['Reception', 'Doctor', 'Pharmacist', 'Nurse', 'AdmissionDesk', 'Accountant'];

    for (const pageId of adminOnlyPages) {
      for (const role of nonAdminRoles) {
        expect(isPageAllowedForRole(pageId, role)).toBe(false);
      }
      expect(isPageAllowedForRole(pageId, 'Administrator')).toBe(true);
      expect(isPageAllowedForRole(pageId, 'SuperAdmin')).toBe(true);
    }
  });

  it('every PageId has a declared role list (no page was left unrestricted by omission)', () => {
    for (const pageId of ALL_PAGE_IDS) {
      expect(PAGE_ROLES[pageId]).toBeDefined();
      expect(PAGE_ROLES[pageId]!.length).toBeGreaterThan(0);
    }
  });

  it('an ordinary role with no single-purpose landing page defaults to dashboard, which it can actually see', () => {
    expect(getDefaultPageForRole('Doctor')).toBe('dashboard');
    expect(isPageAllowedForRole('dashboard', 'Doctor')).toBe(true);
  });
});
