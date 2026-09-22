import React from 'react';
import { ChevronRight, Home } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   Breadcrumb — Contextual Navigation Trail
   ═══════════════════════════════════════════════════════════ */

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
  return (
    /* min-w-0 lets this nav shrink inside the TopNav flex row instead of
       pushing the header actions off-screen -- without it a long trail like
       "Clinical / Employee Directory" overlaps the search/bell/profile icons
       at mobile widths. */
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <Home className="hidden h-3.5 w-3.5 flex-shrink-0 text-[var(--color-text-tertiary)] sm:block" />
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={index}>
            {/* Below `sm` only the current page survives: the ancestor crumbs
                and their separators are hidden rather than truncated, so the
                page title keeps its full width instead of every crumb
                degrading into an unreadable ellipsis. */}
            <ChevronRight
              className={`h-3 w-3 flex-shrink-0 text-[var(--color-text-tertiary)] ${
                isLast ? 'hidden sm:block' : 'hidden sm:block'
              }`}
            />
            {isLast ? (
              <span className="truncate font-medium text-[var(--color-text-primary)] sm:max-w-[200px]">
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="hidden truncate text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] sm:block sm:max-w-[200px]"
              >
                {item.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
