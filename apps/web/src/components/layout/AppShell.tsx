import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar, PageId } from './Sidebar';
import { TopNav } from './TopNav';
import { BreadcrumbItem } from './Breadcrumb';
import { motion, AnimatePresence } from 'framer-motion';

/* ── Enterprise Redesigned Pages ── */
import { DashboardPage } from '../../pages/DashboardPage';
import { EnterpriseReceptionDesk } from '../../pages/reception/EnterpriseReceptionDesk';
import { DoctorWorkspace } from '../../pages/doctor/DoctorWorkspace';
import { PharmacyWorkspace } from '../../pages/pharmacy/PharmacyWorkspace';
import { PatientRecordsPage } from '../../pages/PatientRecordsPage';

/* ── Additional Departmental Screens (Preserved) ── */
import { InventoryScreen } from '../../screens/inventory/InventoryScreen';
import { ExpiryManagementScreen } from '../../screens/inventory/ExpiryManagementScreen';
import { ProcurementScreen } from '../../screens/procurement/ProcurementScreen';
import { BillingScreen } from '../../screens/billing/BillingScreen';
import { SystemConfigScreen } from '../../screens/admin/SystemConfigScreen';
import { OpdQueueScreen } from '../../screens/opd/OpdQueueScreen';
import { FacilityRulesScreen } from '../../screens/admin/FacilityRulesScreen';
import { AdmissionDeskScreen } from '../../screens/admission/AdmissionDeskScreen';
import { WardStaffScreen } from '../../screens/admission/WardStaffScreen';

import { useAuth } from '../../hooks/useAuth';

/* ═══════════════════════════════════════════════════════════
   AppShell — Enterprise Layout Container
   Sidebar + TopNav + Content Area
   ═══════════════════════════════════════════════════════════ */

const PAGE_LABELS: Record<PageId, string> = {
  dashboard: 'Dashboard',
  'patient-search': 'Patient Search',
  'patient-records': 'Patient Records',
  registration: 'Registration',
  'opd-queue': 'OPD Queue',
  consultations: 'Consultations',
  'ipd-admissions': 'IPD / Admissions',
  'ward-console': 'Ward Console',
  pharmacy: 'Dispensing',
  inventory: 'Inventory',
  'expiry-fefo': 'Expiry & FEFO',
  'supply-chain': 'Supply Chain',
  billing: 'Billing',
  'facility-rules': 'Facility Rules',
  analytics: 'Analytics',
  'system-config': 'System Config',
  'system-status': 'System Status',
};

const PAGE_GROUP: Record<PageId, string> = {
  dashboard: 'Overview',
  'patient-search': 'Clinical',
  'patient-records': 'Clinical',
  registration: 'Clinical',
  'opd-queue': 'Clinical',
  consultations: 'Clinical',
  'ipd-admissions': 'Clinical',
  'ward-console': 'Clinical',
  pharmacy: 'Pharmacy & Inventory',
  inventory: 'Pharmacy & Inventory',
  'expiry-fefo': 'Pharmacy & Inventory',
  'supply-chain': 'Pharmacy & Inventory',
  billing: 'Finance',
  'facility-rules': 'Administration',
  analytics: 'Administration',
  'system-config': 'Administration',
  'system-status': 'System',
};

export const AppShell: React.FC = () => {
  const { token, user } = useAuth();
  const authToken = token || '';
  const userRole = user?.role || '';

  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNavigate = useCallback((page: PageId) => {
    setActivePage(page);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    const group = PAGE_GROUP[activePage];
    const label = PAGE_LABELS[activePage];
    const items: BreadcrumbItem[] = [];

    if (group && group !== 'Overview') {
      items.push({ label: group });
    }
    items.push({ label });

    return items;
  }, [activePage]);

  useEffect(() => {
    const width = sidebarCollapsed
      ? 'var(--sidebar-width-collapsed)'
      : 'var(--sidebar-width-expanded)';
    document.documentElement.style.setProperty('--current-sidebar-width', width);
  }, [sidebarCollapsed]);

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'patient-search':
        return <EnterpriseReceptionDesk authToken={authToken} initialWorkflow="universal-search" />;
      case 'patient-records':
        return <PatientRecordsPage />;
      case 'registration':
        return <EnterpriseReceptionDesk authToken={authToken} initialWorkflow="esic-beneficiary" />;
      case 'opd-queue':
        return <OpdQueueScreen authToken={authToken} />;
      case 'consultations':
        return <DoctorWorkspace authToken={authToken} />;
      case 'ipd-admissions':
        return <AdmissionDeskScreen authToken={authToken} />;
      case 'ward-console':
        return <WardStaffScreen authToken={authToken} userRole={userRole} />;
      case 'pharmacy':
        return <PharmacyWorkspace authToken={authToken} />;
      case 'inventory':
        return <InventoryScreen authToken={authToken} />;
      case 'expiry-fefo':
        return <ExpiryManagementScreen authToken={authToken} />;
      case 'supply-chain':
        return <ProcurementScreen authToken={authToken} />;
      case 'billing':
        return <BillingScreen authToken={authToken} />;
      case 'facility-rules':
        return <FacilityRulesScreen authToken={authToken} />;
      case 'analytics':
        return <DashboardPage />;
      case 'system-config':
        return <SystemConfigScreen authToken={authToken} />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      {/* TopNav */}
      <TopNav breadcrumbs={breadcrumbs} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />

      {/* Command Palette Overlay */}
      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPaletteOverlay
            onClose={() => setCommandPaletteOpen(false)}
            onNavigate={(page) => {
              handleNavigate(page);
              setCommandPaletteOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Main Content Area */}
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
              key={activePage}
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

/* ═══════════════════════════════════════════════════════════
   Command Palette — Ctrl+K Global Search (inline component)
   ═══════════════════════════════════════════════════════════ */

import { Search, X, ArrowRight } from 'lucide-react';

interface CommandPaletteOverlayProps {
  onClose: () => void;
  onNavigate: (page: PageId) => void;
}

const SEARCHABLE_PAGES: { id: PageId; label: string; group: string; keywords: string[] }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    group: 'Overview',
    keywords: ['home', 'main', 'overview'],
  },
  {
    id: 'patient-search',
    label: 'Patient Search',
    group: 'Clinical',
    keywords: ['find', 'lookup', 'patient', 'search', 'uid'],
  },
  {
    id: 'patient-records',
    label: 'Patient Records',
    group: 'Clinical',
    keywords: ['master', 'records', 'profile', 'visits', 'admissions', 'history', 'bills'],
  },
  {
    id: 'registration',
    label: 'Registration',
    group: 'Clinical',
    keywords: ['register', 'new patient', 'employee', 'uid'],
  },
  {
    id: 'opd-queue',
    label: 'OPD Queue',
    group: 'Clinical',
    keywords: ['outpatient', 'queue', 'token', 'waiting'],
  },
  {
    id: 'consultations',
    label: 'Consultations',
    group: 'Clinical',
    keywords: ['doctor', 'prescription', 'diagnosis', 'rx'],
  },
  {
    id: 'ipd-admissions',
    label: 'IPD / Admissions',
    group: 'Clinical',
    keywords: ['inpatient', 'admission', 'bed', 'ward'],
  },
  {
    id: 'ward-console',
    label: 'Ward Console',
    group: 'Clinical',
    keywords: ['ward', 'bed', 'nurse', 'nursing'],
  },
  {
    id: 'pharmacy',
    label: 'Dispensing',
    group: 'Pharmacy',
    keywords: ['pharmacy', 'medicine', 'dispense', 'rx'],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    group: 'Inventory',
    keywords: ['stock', 'medicine', 'batch', 'store'],
  },
  {
    id: 'expiry-fefo',
    label: 'Expiry & FEFO',
    group: 'Inventory',
    keywords: ['expiry', 'expired', 'quarantine', 'fefo'],
  },
  {
    id: 'supply-chain',
    label: 'Supply Chain',
    group: 'Supply',
    keywords: ['procurement', 'purchase', 'order', 'grn'],
  },
  {
    id: 'billing',
    label: 'Billing',
    group: 'Finance',
    keywords: ['bill', 'receipt', 'payment', 'revenue'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    group: 'Admin',
    keywords: ['analytics', 'report', 'chart', 'statistics'],
  },
  {
    id: 'facility-rules',
    label: 'Facility Rules',
    group: 'Admin',
    keywords: ['rules', 'eligibility', 'facility'],
  },
  {
    id: 'system-config',
    label: 'System Config',
    group: 'Admin',
    keywords: ['settings', 'configuration', 'system'],
  },
];

const CommandPaletteOverlay: React.FC<CommandPaletteOverlayProps> = ({ onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return SEARCHABLE_PAGES.slice(0, 8);
    const q = query.toLowerCase();
    return SEARCHABLE_PAGES.filter(
      (page) =>
        page.label.toLowerCase().includes(q) ||
        page.group.toLowerCase().includes(q) ||
        page.keywords.some((kw) => kw.includes(q)),
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onNavigate(results[selectedIndex].id);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 overlay-backdrop flex items-start justify-center pt-[15vh]"
      style={{ zIndex: 'var(--z-command-palette)' as unknown as number }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl overflow-hidden"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, patients, medicines..."
            className="flex-1 py-3.5 text-sm bg-transparent border-none outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
          />
          <button
            onClick={onClose}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
              No results found for &quot;{query}&quot;
            </div>
          ) : (
            results.map((page, index) => (
              <button
                key={page.id}
                onClick={() => onNavigate(page.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  index === selectedIndex
                    ? 'bg-primary-50 text-primary-600 [data-theme=dark]:bg-primary-900/30'
                    : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {page.label}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{page.group}</p>
                </div>
                {index === selectedIndex && (
                  <ArrowRight className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center gap-4 text-[10px] text-[var(--color-text-tertiary)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono">
              ↵
            </kbd>
            Open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono">
              esc
            </kbd>
            Close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};
