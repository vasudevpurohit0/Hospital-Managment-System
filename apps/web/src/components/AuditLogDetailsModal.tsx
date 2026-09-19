import React from 'react';
import { X, Monitor, Globe2, Smartphone } from 'lucide-react';
import { AuditLogEntry } from '../api/audit-log.api';
import { Badge } from './ui/Badge';
import {
  actionVerb,
  actionBadgeVariant,
  severityBadgeVariant,
  statusBadgeVariant,
  formatIST,
  actorDisplayName,
  actorInitial,
} from '../utils/auditLog';

interface AuditLogDetailsModalProps {
  entry: AuditLogEntry;
  onClose: () => void;
}

export const AuditLogDetailsModal: React.FC<AuditLogDetailsModalProps> = ({ entry, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--color-surface)] rounded-xl shadow-xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={actionBadgeVariant(entry.action)}>{actionVerb(entry.action)}</Badge>
            <Badge variant={severityBadgeVariant(entry.severity)}>{entry.severity}</Badge>
            <Badge variant={statusBadgeVariant(entry.status)}>
              {entry.status === 'SUCCESS' ? 'Success' : 'Failed'}
            </Badge>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              User
            </p>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 font-bold flex items-center justify-center flex-shrink-0">
                {actorInitial(entry)}
              </span>
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">
                  {actorDisplayName(entry)}
                </p>
                {entry.actorUser?.identifier && (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {entry.actorUser.identifier}
                  </p>
                )}
              </div>
            </div>
            <Badge variant="neutral">{entry.actorRole}</Badge>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Action Details
            </p>
            <p>
              <span className="text-[var(--color-text-tertiary)]">Module:</span> {entry.entityType}
            </p>
            <p>
              <span className="text-[var(--color-text-tertiary)]">Record ID:</span> #
              {entry.entityId.slice(0, 8)}
            </p>
            {entry.changedFields.length > 0 && (
              <p>
                <span className="text-[var(--color-text-tertiary)]">Changed:</span>{' '}
                {entry.changedFields.join(', ')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Request Info
            </p>
            <p>
              <span className="text-[var(--color-text-tertiary)]">Timestamp:</span>{' '}
              {formatIST(entry.createdAt)} IST
            </p>
            <p className="flex items-center gap-1.5">
              <Globe2 className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />{' '}
              {entry.ipAddress ?? 'Unknown'}
            </p>
            <p className="flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />{' '}
              {entry.browser ?? 'Unknown'} · {entry.os ?? 'Unknown'}
            </p>
            <p className="flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />{' '}
              {entry.device ?? 'Unknown'}
            </p>
          </div>
        </div>

        {(entry.description || entry.reason) && (
          <div className="bg-[var(--color-surface-secondary)] rounded-lg p-4 space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Description
            </p>
            <p className="text-sm text-[var(--color-text-primary)]">{entry.description}</p>
            {entry.reason && (
              <p className="text-xs text-[var(--color-text-secondary)]">Reason: {entry.reason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
