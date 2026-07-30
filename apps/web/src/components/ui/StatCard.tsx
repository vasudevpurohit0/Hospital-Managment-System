import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    direction: 'up' | 'down' | 'neutral';
    label?: string;
  };
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
}

const variantStyles = {
  primary:
    'bg-primary-50 text-primary-600 border-primary-100 dark:bg-primary-950/30 dark:text-primary-400 dark:border-primary-900/50',
  secondary:
    'bg-secondary-50 text-secondary-600 border-secondary-100 dark:bg-secondary-950/30 dark:text-secondary-400 dark:border-secondary-900/50',
  success:
    'bg-success-50 text-success-600 border-success-100 dark:bg-success-950/30 dark:text-success-400 dark:border-success-900/50',
  warning:
    'bg-warning-50 text-warning-600 border-warning-100 dark:bg-warning-950/30 dark:text-warning-400 dark:border-warning-900/50',
  danger:
    'bg-danger-50 text-danger-600 border-danger-100 dark:bg-danger-950/30 dark:text-danger-400 dark:border-danger-900/50',
  info: 'bg-info-50 text-info-500 border-info-100 dark:bg-info-950/30 dark:text-info-400 dark:border-info-900/50',
};

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'primary',
}) => {
  return (
    <div className="card p-5 relative overflow-hidden flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            {title}
          </p>
          <h3 className="text-2xl font-bold text-[var(--color-text-primary)] mt-1 tracking-tight">
            {value}
          </h3>
        </div>
        <div className={`p-3 rounded-xl border flex-shrink-0 ${variantStyles[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {(subtitle || trend) && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center justify-between text-xs">
          {trend && (
            <div
              className={`flex items-center gap-1 font-semibold ${
                trend.direction === 'up'
                  ? 'text-success-600'
                  : trend.direction === 'down'
                    ? 'text-danger-600'
                    : 'text-[var(--color-text-tertiary)]'
              }`}
            >
              {trend.direction === 'up' && <TrendingUp className="w-3.5 h-3.5" />}
              {trend.direction === 'down' && <TrendingDown className="w-3.5 h-3.5" />}
              {trend.direction === 'neutral' && <Minus className="w-3.5 h-3.5" />}
              <span>{trend.value}</span>
              {trend.label && (
                <span className="font-normal text-[var(--color-text-tertiary)]">{trend.label}</span>
              )}
            </div>
          )}
          {subtitle && !trend && (
            <span className="text-[var(--color-text-secondary)]">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
};
