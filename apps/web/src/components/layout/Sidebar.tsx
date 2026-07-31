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
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   Sidebar — Collapsible Navigation with Role-Based Menus
   Inspired by SAP Fiori shell and Cerner Millennium nav
   ═══════════════════════════════════════════════════════════ */

export type PageId =
  | 'dashboard'
  | 'patient-search'
  | 'registration'
  | 'opd-queue'
  | 'consultations'
  | 'ipd-admissions'
  | 'ward-console'
  | 'pharmacy'
  | 'inventory'
  | 'expiry-fefo'
  | 'supply-chain'
  | 'billing'
  | 'facility-rules'
  | 'analytics'
  | 'system-config'
  | 'system-status';

interface MenuItem {
  id: PageId;
  label: string;
  icon: React.ElementType;
  roles: string[];
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['*'] }],
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
        id: 'registration',
        label: 'Registration',
        icon: UserPlus,
        roles: ['Reception', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'opd-queue',
        label: 'OPD Queue',
        icon: ClipboardList,
        roles: ['Doctor', 'Reception', 'Nurse', 'SuperAdmin', 'Administrator'],
      },
      {
        id: 'consultations',
        label: 'Consultations',
        icon: Stethoscope,
        roles: ['Doctor', 'SuperAdmin', 'Administrator'],
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
        roles: ['Nurse', 'SuperAdmin', 'Administrator'],
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
        roles: ['StoreManager', 'SuperAdmin', 'Administrator'],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        id: 'billing',
        label: 'Billing',
        icon: Receipt,
        roles: ['Pharmacist', 'SuperAdmin', 'Administrator'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        id: 'facility-rules',
        label: 'Facility Rules',
        icon: Shield,
        roles: ['SuperAdmin', 'Administrator'],
      },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: BarChart3,
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

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  collapsed,
  onToggleCollapse,
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
    if (collapsed) return;
    setExpandedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 flex flex-col sidebar-transition ${
        collapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width-expanded)]'
      }`}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        zIndex: 'var(--z-sidebar)' as unknown as number,
      }}
    >
      {/* ── Brand Header ── */}
      <div
        className={`flex items-center h-[var(--topnav-height)] flex-shrink-0 border-b border-white/[0.06] ${
          collapsed ? 'justify-center px-2' : 'px-5'
        }`}
      >
        {collapsed ? (
          <div className="w-9 h-9 rounded-lg bg-primary-500/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary-300" />
          </div>
        ) : (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary-500/20 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-primary-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[13px] font-bold text-white truncate">ESIC HMS</h1>
              <p className="text-[10px] text-[var(--sidebar-text)] opacity-50 truncate">
                Hospital Management
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-thin">
        {filteredGroups.map((group) => (
          <div key={group.title} className="mb-1">
            {/* Group Header */}
            {!collapsed && (
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
              {(collapsed || expandedGroups[group.title]) && (
                <motion.div
                  initial={collapsed ? false : { height: 0, opacity: 0 }}
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
                        onClick={() => onNavigate(item.id)}
                        title={collapsed ? item.label : undefined}
                        className={`
                          w-full flex items-center gap-3 sidebar-item-transition relative
                          ${collapsed ? 'justify-center px-2 py-2.5 mx-auto' : 'px-5 py-2'}
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
                          className={`flex-shrink-0 ${collapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`}
                        />

                        {!collapsed && (
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
      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-center h-10 border-t border-b border-white/[0.06] text-[var(--sidebar-text)] hover:text-white hover:bg-[var(--sidebar-item-hover)] transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          className={`w-4 h-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── User & Logout ── */}
      <div
        className={`flex-shrink-0 border-t border-white/[0.06] p-3 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}
      >
        {collapsed ? (
          <>
            <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-xs font-bold text-primary-300">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <button
              onClick={logout}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--sidebar-text)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Sign Out"
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
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
