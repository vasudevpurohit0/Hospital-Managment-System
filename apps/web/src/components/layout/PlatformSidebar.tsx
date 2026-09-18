import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Building2,
  ShieldCheck,
  FileClock,
  LogOut,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   PlatformSidebar — visually matches Sidebar.tsx exactly (same
   dark-navy background, grouped nav, framer-motion active-item
   accent bar) but for the Platform Console's own small, fixed
   page set -- there is only ever one role here (the global
   Super Admin), so unlike Sidebar.tsx there is no per-item role
   filtering to do.
   ═══════════════════════════════════════════════════════════ */

export type PlatformPageId = 'dashboard' | 'hospitals' | 'create-hospital' | 'admins' | 'audit-log';

interface MenuItem {
  id: PlatformPageId;
  label: string;
  icon: React.ElementType;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Hospitals',
    items: [
      { id: 'hospitals', label: 'All Hospitals', icon: Building2 },
      { id: 'admins', label: 'Platform Admins', icon: ShieldCheck },
    ],
  },
  {
    title: 'Security',
    items: [{ id: 'audit-log', label: 'Audit Log', icon: FileClock }],
  },
];

interface PlatformSidebarProps {
  activePage: PlatformPageId;
  onNavigate: (page: PlatformPageId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const PlatformSidebar: React.FC<PlatformSidebarProps> = ({
  activePage,
  onNavigate,
  collapsed,
  onToggleCollapse,
}) => {
  const { user, logout } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Overview: true,
    Hospitals: true,
    Security: true,
  });

  const toggleGroup = (title: string) => {
    if (collapsed) return;
    setExpandedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  // "create-hospital" is a sub-view of Hospitals (reached via a button
  // there), not its own persistent nav entry -- highlight "All Hospitals"
  // while on it, same way a hospital-side wizard step would.
  const highlightedPage = activePage === 'create-hospital' ? 'hospitals' : activePage;

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
          collapsed ? 'justify-center px-2' : 'px-4'
        }`}
      >
        {collapsed ? (
          <div className="w-9 h-9 rounded-lg bg-white/10 p-1 flex items-center justify-center border border-white/20 shadow-xs">
            <Building2 className="w-full h-full text-amber-300" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/10 p-1 flex items-center justify-center flex-shrink-0 border border-white/20 shadow-xs">
              <Building2 className="w-full h-full text-amber-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[12px] font-extrabold text-white truncate">Platform Console</h1>
              <p className="text-[10px] text-amber-300 font-medium truncate">Super Admin</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-thin">
        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="mb-1">
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
                    const isActive = highlightedPage === item.id;

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
                        {isActive && (
                          <motion.div
                            layoutId="platform-sidebar-active-indicator"
                            className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-[var(--sidebar-accent)]"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}

                        <Icon className={`flex-shrink-0 ${collapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`} />

                        {!collapsed && <span className="text-[13px] font-medium truncate">{item.label}</span>}
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
        <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      {/* ── User & Logout ── */}
      <div
        className={`flex-shrink-0 border-t border-white/[0.06] p-3 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}
      >
        {collapsed ? (
          <>
            <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-xs font-bold text-primary-300">
              {user?.name?.charAt(0) || 'S'}
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
              {user?.name?.charAt(0) || 'S'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white truncate">{user?.name || 'Super Admin'}</p>
              <p className="text-[10px] text-[var(--sidebar-text)] opacity-50 truncate">{user?.email}</p>
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
