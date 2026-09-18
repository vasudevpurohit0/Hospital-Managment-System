import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlatformSidebar, PlatformPageId } from './PlatformSidebar';
import { TopNav } from './TopNav';
import { BreadcrumbItem } from './Breadcrumb';
import { PlatformDashboardScreen } from '../../screens/platform/PlatformDashboardScreen';
import { HospitalsListScreen } from '../../screens/platform/HospitalsListScreen';
import { CreateHospitalScreen } from '../../screens/platform/CreateHospitalScreen';
import { PlatformAdminsScreen } from '../../screens/platform/PlatformAdminsScreen';
import { PlatformAuditLogScreen } from '../../screens/platform/PlatformAuditLogScreen';

const PAGE_LABELS: Record<PlatformPageId, string> = {
  dashboard: 'Dashboard',
  hospitals: 'All Hospitals',
  'create-hospital': 'Onboard Hospital',
  admins: 'Platform Admins',
  'audit-log': 'Audit Log',
};

const PAGE_GROUP: Record<PlatformPageId, string> = {
  dashboard: 'Overview',
  hospitals: 'Hospitals',
  'create-hospital': 'Hospitals',
  admins: 'Hospitals',
  'audit-log': 'Security',
};

/**
 * The Super Admin's landing area before entering a specific hospital.
 * Mirrors AppShell.tsx's Sidebar+TopNav composition exactly so the two
 * shells are visually and structurally identical. Once a hospital is
 * entered, useAuth().activeHospital being set routes AppContent to the
 * existing AppShell instead, so all the real clinical screens are reused
 * unmodified.
 */
export const PlatformConsole: React.FC = () => {
  const [page, setPage] = useState<PlatformPageId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const width = sidebarCollapsed
      ? 'var(--sidebar-width-collapsed)'
      : 'var(--sidebar-width-expanded)';
    document.documentElement.style.setProperty('--current-sidebar-width', width);
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleNavigate = useCallback((next: PlatformPageId) => {
    setPage(next);
  }, []);

  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    const group = PAGE_GROUP[page];
    const label = PAGE_LABELS[page];
    const items: BreadcrumbItem[] = [];
    if (group && group !== 'Overview') {
      items.push({ label: group });
    }
    items.push({ label });
    return items;
  }, [page]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <PlatformDashboardScreen />;
      case 'hospitals':
        return <HospitalsListScreen onCreateHospital={() => setPage('create-hospital')} />;
      case 'create-hospital':
        return (
          <CreateHospitalScreen onCreated={() => setPage('hospitals')} onCancel={() => setPage('hospitals')} />
        );
      case 'admins':
        return <PlatformAdminsScreen />;
      case 'audit-log':
        return <PlatformAuditLogScreen />;
      default:
        return <PlatformDashboardScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <PlatformSidebar
        activePage={page}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      <TopNav breadcrumbs={breadcrumbs} onOpenCommandPalette={() => {}} variant="platform" />

      <main
        className="transition-[margin] duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          marginLeft: sidebarCollapsed
            ? 'var(--sidebar-width-collapsed)'
            : 'var(--sidebar-width-expanded)',
          paddingTop: 'var(--topnav-height)',
        }}
      >
        <div className="p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};
