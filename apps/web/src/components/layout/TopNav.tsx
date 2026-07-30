import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  Search,
  Bell,
  Moon,
  Sun,
  Monitor,
  ChevronDown,
  LogOut,
  User,
  Settings,
  Command,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Breadcrumb, BreadcrumbItem } from './Breadcrumb';

/* ═══════════════════════════════════════════════════════════
   TopNav — Fixed Header with Search, Notifications, Profile
   ═══════════════════════════════════════════════════════════ */

type ThemeMode = 'light' | 'dark' | 'system';

interface TopNavProps {
  breadcrumbs: BreadcrumbItem[];
  onOpenCommandPalette: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({ breadcrumbs, onOpenCommandPalette }) => {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('esic-theme') as ThemeMode) || 'light';
  });

  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    let effectiveTheme: 'light' | 'dark';

    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effectiveTheme = theme;
    }

    root.setAttribute('data-theme', effectiveTheme);
    localStorage.setItem('esic-theme', theme);
  }, [theme]);

  // Close dropdowns on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
      setProfileOpen(false);
    }
    if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
      setNotificationOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  // Mock notifications
  const notifications = [
    {
      id: '1',
      type: 'danger' as const,
      title: 'Critical: Low stock alert',
      desc: 'Paracetamol 500mg below minimum',
      time: '2 min ago',
    },
    {
      id: '2',
      type: 'warning' as const,
      title: 'Medicine expiry warning',
      desc: '3 batches expiring in 30 days',
      time: '15 min ago',
    },
    {
      id: '3',
      type: 'info' as const,
      title: 'New admission',
      desc: 'Patient Rahul Kumar admitted to Ward A',
      time: '1 hr ago',
    },
  ];

  const unreadCount = notifications.length;

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  const cycleTheme = () => {
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    const nextIndex = (modes.indexOf(theme) + 1) % modes.length;
    setTheme(modes[nextIndex]);
  };

  return (
    <header
      className="fixed top-0 right-0 flex items-center justify-between h-[var(--topnav-height)] px-5 border-b"
      style={{
        backgroundColor: 'var(--topnav-bg)',
        borderColor: 'var(--topnav-border)',
        zIndex: 'var(--z-topnav)' as unknown as number,
        left: 'var(--current-sidebar-width, var(--sidebar-width-expanded))',
        transition: 'left var(--transition-spring)',
      }}
    >
      {/* Left — Breadcrumb */}
      <div className="flex items-center gap-4 min-w-0">
        <Breadcrumb items={breadcrumbs} />
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-1">
        {/* Search Trigger */}
        <button
          onClick={onOpenCommandPalette}
          className="btn btn-ghost gap-2 text-[var(--color-text-secondary)]"
          title="Search (Ctrl+K)"
        >
          <Search className="w-4 h-4" />
          <span className="hidden sm:inline text-xs">Search...</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-tertiary)]">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>

        {/* Theme Toggle */}
        <button onClick={cycleTheme} className="btn btn-ghost btn-icon" title={`Theme: ${theme}`}>
          <ThemeIcon className="w-4 h-4 text-[var(--color-text-secondary)]" />
        </button>

        {/* Notifications */}
        <div ref={notificationRef} className="relative">
          <button
            onClick={() => {
              setNotificationOpen(!notificationOpen);
              setProfileOpen(false);
            }}
            className="btn btn-ghost btn-icon relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4 text-[var(--color-text-secondary)]" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-danger-500 text-white text-[9px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {notificationOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden"
                style={{ zIndex: 'var(--z-notification)' as unknown as number }}
              >
                <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Notifications
                  </h3>
                  <button className="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    Mark all read
                  </button>
                </div>
                <div className="max-h-[320px] overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)] last:border-0 cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            n.type === 'danger'
                              ? 'bg-danger-500'
                              : n.type === 'warning'
                                ? 'bg-warning-500'
                                : 'bg-primary-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {n.title}
                          </p>
                          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                            {n.desc}
                          </p>
                          <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
                            {n.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

        {/* Profile Dropdown */}
        <div ref={profileRef} className="relative">
          <button
            onClick={() => {
              setProfileOpen(!profileOpen);
              setNotificationOpen(false);
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-primary-500/10 flex items-center justify-center text-xs font-bold text-primary-500 flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="hidden sm:block text-left min-w-0">
              <p className="text-xs font-medium text-[var(--color-text-primary)] truncate max-w-[120px]">
                {user?.name || 'User'}
              </p>
              <p className="text-[10px] text-[var(--color-text-tertiary)] truncate max-w-[120px]">
                {user?.role || 'Role'}
              </p>
            </div>
            <ChevronDown className="w-3 h-3 text-[var(--color-text-tertiary)] hidden sm:block" />
          </button>

          <AnimatePresence>
            {profileOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden"
                style={{ zIndex: 'var(--z-dropdown)' as unknown as number }}
              >
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {user?.name}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">{user?.email}</p>
                </div>
                <div className="py-1">
                  {[
                    { icon: User, label: 'My Profile', action: () => {} },
                    { icon: Settings, label: 'Preferences', action: () => {} },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        item.action();
                        setProfileOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-[var(--color-border)] py-1">
                  <button
                    onClick={() => {
                      logout();
                      setProfileOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger-500 hover:bg-danger-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
};
