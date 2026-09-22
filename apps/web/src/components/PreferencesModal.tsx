import React from 'react';
import { X, Sun, Moon, Monitor, Check } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

interface PreferencesModalProps {
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  onClose: () => void;
}

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', description: 'Always use the light appearance.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always use the dark appearance.', icon: Moon },
  { value: 'system', label: 'System', description: "Match this device's setting.", icon: Monitor },
];

/** "Preferences" from the top-nav dropdown. Same theme state TopNav already owns (and the sun/moon icon still cycles) -- this just makes the three options discoverable and explicit rather than relying on the icon's cycle-through behavior. */
export const PreferencesModal: React.FC<PreferencesModalProps> = ({ theme, onChangeTheme, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop px-4">
      <div className="w-full max-w-sm card p-6 space-y-5 animate-scale-in">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Preferences</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wide">Theme</p>
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                onClick={() => onChangeTheme(option.value)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  active
                    ? 'border-primary-500 bg-primary-500/5'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <Icon className="w-4 h-4 text-[var(--color-text-secondary)] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{option.label}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{option.description}</p>
                </div>
                {active && <Check className="w-4 h-4 text-primary-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
