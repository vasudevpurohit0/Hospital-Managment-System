import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Search,
  UserPlus,
  ClipboardList,
  Stethoscope,
  BedDouble,
  Building2,
  Pill,
  Package,
  Clock,
  Truck,
  Receipt,
  Shield,
  IndianRupee,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Microscope,
  Activity,
  Download,
  Lock,
  Users,
  Info,
} from 'lucide-react';

const SINGLE_PURPOSE_ROLES: Record<string, string> = {
  QueueManager: 'This is your only screen — calling patients is this account’s one job.',
  LabTechnician: 'This is your only screen — sample collection and result entry are this account’s only tasks.',
  Pathologist: 'This is your only screen — verifying and releasing lab reports is this account’s only task.',
  OPDDisplayOperator: 'This is your only screen — a read-only public waiting-area OPD display.',
  THERAPY_STAFF: 'This is your only screen — performing and recording Therapy / Panchakarma sessions.',
};

/* ═══════════════════════════════════════════════════════════
   Sidebar — Collapsible Navigation with Role-Based Menus
   Inspired by SAP Fiori shell and Cerner Millennium nav
   ═══════════════════════════════════════════════════════════ */

export type PageId =
  | 'dashboard'
  | 'patient-search'
  | 'patient-records'
  | 'registration'
  | 'employee-directory'
  | 'opd-queue'
  | 'opd-display'
  | 'consultations'
  | 'doctor-schedule'
  | 'ipd-admissions'
  | 'ward-console'
  | 'laboratory'
  | 'therapy'
  | 'pharmacy'
  | 'inventory'
  | 'expiry-fefo'
  | 'supply-chain'
  | 'billing'
  | 'patient-ledger'
  | 'facility-rules'
  | 'service-pricing'
  | 'department-management'
  | 'analytics'
  | 'reports'
  | 'rbac-management'
  | 'system-config'
  | 'staff-management'
  | 'activity-log';

interface MenuItem {
  id: PageId;
  label: string;
  icon: React.ElementType;
  roles: string[];
  description?: string;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Reception', 'Doctor', 'AdmissionDesk', 'Nurse', 'Pharmacist', 'StoreManager', 'ProcurementOfficer', 'DataEntryOperator', 'Administrator', 'SuperAdmin', 'Accountant'] }],
  },
  {
    title: 'Clinical',
    items: [
      {
        id: 'patient-search',
        label: 'Patient Search',
        icon: Search,
        roles: ['Doctor', 'Reception', 'Pharmacist', 'Nurse', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'patient-records',
        label: 'Patient Records',
        icon: ClipboardList,
        // Reception removed: this page reads full diagnosis/prescription/lab
        // history via the backend's new PatientHistory:read permission
        // (V-06), which Reception no longer holds -- they'd otherwise land
        // here and get 403s on every clinical section. Reception's own
        // identity/registration lookups stay on Patient Search above.
        roles: ['Doctor', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'registration',
        label: 'Registration',
        icon: UserPlus,
        roles: ['Reception', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'employee-directory',
        label: 'Employee Directory',
        icon: Users,
        // This is the only screen a DataEntryOperator has any use for — it
        // matches exactly the Employee:create/update scope FR-SEC-13 grants
        // that role and nothing more.
        roles: ['DataEntryOperator', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'opd-queue',
        label: 'OPD Queue',
        icon: ClipboardList,
        // Doctor deliberately excluded -- a doctor's own queue now lives
        // entirely inside Consultations (DoctorWorkspace's "My OPD Queue"
        // panel), not the shared cross-department queue screen.
        roles: ['Reception', 'Nurse', 'SuperAdmin', 'Administrator', 'QueueManager'],
      },
      {
        id: 'opd-display',
        label: 'OPD Public Display',
        icon: ClipboardList,
        // Read-only public waiting-area TV. The dedicated OPDDisplayOperator
        // account lands here as its only screen; SuperAdmin/Administrator can
        // also open it for setup/preview.
        roles: ['OPDDisplayOperator', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'consultations',
        label: 'Consultations',
        icon: Stethoscope,
        roles: ['Doctor', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'doctor-schedule',
        label: 'Doctor Schedule',
        icon: Stethoscope,
        roles: ['Reception', 'Doctor', 'Nurse', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'ipd-admissions',
        label: 'IPD / Admissions',
        icon: BedDouble,
        roles: ['AdmissionDesk', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'ward-console',
        label: 'Ward Console',
        icon: Building2,
        // Doctor holds Admission:approve (discharge) and can already reach
        // this screen's discharge action once here — the nav item was
        // missing, so there was no way to click through to it.
        roles: ['Nurse', 'Doctor', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'laboratory',
        label: 'Laboratory',
        icon: Microscope,
        roles: ['LabTechnician', 'Pathologist', 'Doctor', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'therapy',
        label: 'Therapy / Panchakarma',
        icon: Activity,
        roles: ['Doctor', 'Nurse', 'SuperAdmin', 'Administrator', 'THERAPY_STAFF'],
      },
    ],
  },
  {
    title: 'Pharmacy & Inventory',
    items: [
      {
        id: 'pharmacy',
        label: 'Dispensing',
        icon: Pill,
        roles: ['Pharmacist', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'inventory',
        label: 'Inventory',
        icon: Package,
        roles: ['Pharmacist', 'StoreManager', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'expiry-fefo',
        label: 'Expiry & FEFO',
        icon: Clock,
        roles: ['Pharmacist', 'StoreManager', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'supply-chain',
        label: 'Supply Chain',
        icon: Truck,
        roles: ['StoreManager', 'ProcurementOfficer', 'SuperAdmin', 'Administrator'],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        id: 'patient-ledger',
        label: 'Patient Ledger',
        icon: IndianRupee,
        roles: ['Reception', 'AdmissionDesk', 'SuperAdmin', 'Administrator', 'Accountant'],
        description: 'Central multi-department patient accounts and unified billing ledger',
      },
      {
        id: 'billing',
        label: 'Pharmacy Counter',
        icon: Receipt,
        roles: ['Pharmacist', 'SuperAdmin', 'Administrator'],
        description: 'Point-of-dispense medicine bills and pharmacy receipts',
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        id: 'staff-management',
        label: 'Staff Management',
        icon: Users,
        roles: ['SuperAdmin', 'Administrator'],
        description: 'Create and manage staff accounts, passwords, and lock status',
      },
      {
        id: 'activity-log',
        label: 'Activity Log',
        icon: ClipboardList,
        roles: ['SuperAdmin', 'Administrator'],
        description: 'Audit trail of staff actions for this hospital',
      },
      {
        id: 'service-pricing',
        label: 'Service Pricing',
        icon: IndianRupee,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'facility-rules',
        label: 'Facility Rules',
        icon: Shield,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'department-management',
        label: 'Departments',
        icon: Building2,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: BarChart3,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'reports',
        label: 'Reports',
        icon: Download,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'rbac-management',
        label: 'Roles & Permissions',
        icon: Lock,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'system-config',
        label: 'System Config',
        icon: Settings,
        roles: ['SuperAdmin', 'Administrator'],
      },
    ],
  },
];

/**
 * Pages ↔ roles allowed, flattened from MENU_GROUPS -- the single source of
 * truth for both hiding a nav link (this component's own `isItemVisible`
 * below) and blocking direct URL navigation to a page a role isn't allowed
 * to see (AppShell's route guard). Previously only the sidebar link was
 * hidden; a role could still navigate straight to the URL of any screen and
 * have it fully render client-side, with only the backend's own permission
 * checks (on the API calls the screen makes) actually stopping anything.
 */
export const PAGE_ROLES: Partial<Record<PageId, string[]>> = Object.fromEntries(
  MENU_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.roles])),
) as Partial<Record<PageId, string[]>>;

export function isPageAllowedForRole(pageId: PageId, role: string | undefined | null): boolean {
  if (!role) return false;
  const roles = PAGE_ROLES[pageId];
  if (!roles) return true; // no entry means this page was never declared restricted
  return roles.includes('*') || roles.includes(role);
}

/** Roles whose sidebar exposes exactly one screen (see SINGLE_PURPOSE_ROLES above) land there directly, since 'dashboard' isn't in their allowed-pages list either. */
const SINGLE_PURPOSE_LANDING_PAGE: Partial<Record<string, PageId>> = {
  QueueManager: 'opd-queue',
  LabTechnician: 'laboratory',
  Pathologist: 'laboratory',
  OPDDisplayOperator: 'opd-display',
  THERAPY_STAFF: 'therapy',
};

export function getDefaultPageForRole(role: string | undefined | null): PageId {
  if (role && SINGLE_PURPOSE_LANDING_PAGE[role]) return SINGLE_PURPOSE_LANDING_PAGE[role]!;
  return 'dashboard';
}

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Below `lg` the sidebar renders as an overlay drawer instead of a column. */
  isMobileNav?: boolean;
  /** Drawer visibility. Ignored unless `isMobileNav`. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  collapsed,
  onToggleCollapse,
  isMobileNav = false,
  mobileOpen = false,
  onMobileClose,
}) => {
  const { user, logout } = useAuth();
  const userRole = user?.role || '';
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Overview: true,
    Clinical: true,
    'Pharmacy & Inventory': true,
    Finance: true,
    Administration: true,
  });

  const isItemVisible = (item: MenuItem): boolean => {
    if (item.roles.includes('*')) return true;
    return item.roles.includes(userRole);
  };

  const filteredGroups = MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(isItemVisible),
  })).filter((group) => group.items.length > 0);

  const toggleGroup = (title: string) => {
    if (isCollapsed) return;
    setExpandedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  /* Mobile renders the full-width drawer regardless of `isCollapsed`: a 64px rail
     of bare icons is not usable as the only navigation on a phone, and the
     drawer overlays content so it costs no layout width either way.
     `isCollapsed` (not the raw prop) drives every branch below -- otherwise the
     drawer would be 260px wide but still render centred, unlabelled icons,
     because AppShell auto-collapses at <1280px. */
  const isCollapsed = isMobileNav ? false : collapsed;
  const widthClass = isCollapsed
    ? 'w-[var(--sidebar-width-collapsed)]'
    : 'w-[var(--sidebar-width-expanded)]';

  return (
    <aside
      className={`fixed bottom-0 left-0 top-0 flex flex-col sidebar-transition ${widthClass} ${
        isMobileNav
          ? `transition-transform duration-300 ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`
          : 'translate-x-0'
      }`}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        zIndex: (isMobileNav
          ? 'var(--z-sidebar-drawer)'
          : 'var(--z-sidebar)') as unknown as number,
      }}
      // Hidden from the a11y tree while closed so screen readers don't announce
      // off-screen links. (`inert` would also drop it from tab order, but it is
      // not in React 18's JSX types -- revisit on the React 19 upgrade.)
      aria-hidden={isMobileNav && !mobileOpen ? true : undefined}
    >
      {/* ── Brand Header ── */}
      <div
        className={`flex items-center h-[var(--topnav-height)] flex-shrink-0 border-b border-white/[0.06] ${
          isCollapsed ? 'justify-center px-2' : 'px-4'
        }`}
      >
        {isCollapsed ? (
          <div className="w-9 h-9 rounded-lg bg-white p-[3px] flex items-center justify-center border border-white/25 shadow-xs">
            <img src="/mp-emblem.webp" alt="AAYUSH SAARTHI — Government of Madhya Pradesh" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white p-[3px] flex items-center justify-center flex-shrink-0 border border-white/25 shadow-xs">
              <img src="/mp-emblem.webp" alt="AAYUSH SAARTHI — Government of Madhya Pradesh" className="w-full h-full object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[12.5px] font-extrabold tracking-tight truncate">
                <span className="text-white">AAYUSH</span>{' '}
                <span className="text-[var(--color-accent-500)]">SAARTHI</span>
              </h1>
              <p className="text-[9.5px] font-medium uppercase tracking-[0.07em] text-white/50 truncate">
                Department of AYUSH
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-thin">
        {!isCollapsed && SINGLE_PURPOSE_ROLES[userRole] && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[10.5px] leading-snug text-[var(--sidebar-text)]">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-[1px] text-[var(--color-accent-400)]" />
            <span>{SINGLE_PURPOSE_ROLES[userRole]}</span>
          </div>
        )}
        {filteredGroups.map((group) => (
          <div key={group.title} className="mb-1">
            {/* Group Header */}
            {!isCollapsed && (
              <button
                onClick={() => toggleGroup(group.title)}
                className="w-full flex items-center justify-between px-5 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--sidebar-text)] opacity-40 hover:opacity-60 transition-opacity"
              >
                <span>{group.title}</span>
                {expandedGroups[group.title] ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            )}

            {/* Group Items */}
            <AnimatePresence initial={false}>
              {(isCollapsed || expandedGroups[group.title]) && (
                <motion.div
                  initial={isCollapsed ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activePage === item.id;

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onNavigate(item.id);
                          // Tapping a link on mobile should reveal the page, not
                          // leave the drawer covering it.
                          onMobileClose?.();
                        }}
                        title={isCollapsed ? item.label : (item.description || undefined)}
                        className={`
                          w-full flex items-center gap-3 sidebar-item-transition relative
                          ${isCollapsed ? 'justify-center px-2 py-2.5 mx-auto' : 'px-5 py-2'}
                          ${
                            isActive
                              ? 'text-white bg-white/[0.08]'
                              : 'text-[var(--sidebar-text)] hover:text-white hover:bg-[var(--sidebar-item-hover)]'
                          }
                        `}
                      >
                        {/* Active indicator bar */}
                        {isActive && (
                          <motion.div
                            layoutId="sidebar-active-indicator"
                            className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-[var(--sidebar-accent)]"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}

                        <Icon
                          className={`flex-shrink-0 ${isCollapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`}
                        />

                        {!isCollapsed && (
                          <span className="text-[13px] font-medium truncate">{item.label}</span>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>

      {/* ── Collapse Toggle ── */}
      {/* Collapsing is a desktop-only affordance: the mobile drawer is always
          full width and is dismissed via the backdrop, Escape or a nav tap. */}
      <button
        onClick={isMobileNav ? onMobileClose : onToggleCollapse}
        className="flex items-center justify-center h-10 border-t border-b border-white/[0.06] text-[var(--sidebar-text)] hover:text-white hover:bg-[var(--sidebar-item-hover)] transition-colors"
        title={isMobileNav ? 'Close menu' : isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          className={`w-4 h-4 transition-transform duration-300 ${
            !isMobileNav && isCollapsed ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* ── User & Logout ── */}
      <div
        className={`flex-shrink-0 border-t border-white/[0.06] p-3 ${isCollapsed ? 'flex flex-col items-center gap-2' : ''}`}
      >
        {isCollapsed ? (
          <>
            <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-xs font-bold text-primary-300">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <button
              onClick={logout}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--sidebar-text)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Sign Out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center text-sm font-bold text-primary-300 flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white truncate">{user?.name || 'User'}</p>
              <p className="text-[10px] text-[var(--sidebar-text)] opacity-50 truncate">
                {user?.role || 'Role'}
              </p>
            </div>
            <button
              onClick={logout}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--sidebar-text)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
              title="Sign Out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
