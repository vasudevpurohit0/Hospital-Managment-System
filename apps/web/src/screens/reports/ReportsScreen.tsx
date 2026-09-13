import React, { useState } from 'react';
import { downloadBillingReport, downloadOutstandingReport, downloadPatientRegisterReport } from '../../api/reports.api';
import { ClipboardList, Download, Receipt, IndianRupee, Users } from 'lucide-react';

interface ReportsScreenProps {
  authToken: string;
}

interface ReportCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  showRange?: boolean;
  onDownload: (range?: { from?: string; to?: string }) => Promise<void>;
}

const ReportCard: React.FC<ReportCardProps> = ({ icon: Icon, title, description, showRange, onDownload }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDownload(showRange ? { from: from || undefined, to: to || undefined } : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center text-primary-600">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{title}</h3>
          <p className="text-[11px] text-[var(--color-text-secondary)]">{description}</p>
        </div>
      </div>

      {showRange && (
        <div className="flex gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input text-xs py-1.5 flex-1" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input text-xs py-1.5 flex-1" />
        </div>
      )}

      {error && <p className="text-[11px] text-danger-600">{error}</p>}

      <button onClick={handleClick} disabled={busy} className="btn btn-secondary btn-sm w-full gap-2">
        <Download className="w-3.5 h-3.5" /> {busy ? 'Generating…' : 'Download CSV'}
      </button>
    </div>
  );
};

export const ReportsScreen: React.FC<ReportsScreenProps> = ({ authToken }) => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
          <ClipboardList className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Report Centre</h1>
          <p className="text-xs text-primary-200/80 mt-0.5">
            Downloadable CSV exports, generated on demand from the live charge ledger (Feature 13)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <ReportCard
          icon={Receipt}
          title="Billing Report"
          description="Every non-cancelled charge — service, amounts, outcome, receipt."
          showRange
          onDownload={(range) => downloadBillingReport(authToken, range)}
        />
        <ReportCard
          icon={IndianRupee}
          title="Outstanding Report"
          description="Every patient with a pending balance, ranked by amount owed."
          onDownload={() => downloadOutstandingReport(authToken)}
        />
        <ReportCard
          icon={Users}
          title="Patient Register"
          description="Every registered patient — UHID, employee ID, department, employment type."
          showRange
          onDownload={(range) => downloadPatientRegisterReport(authToken, range)}
        />
      </div>

      <div className="card p-4 text-[11px] text-[var(--color-text-tertiary)]">
        Additional breakdowns (Visit / Laboratory / Therapy / Pharmacy / Department revenue) are already
        available as structured data on the Analytics screen; these three exports cover the highest-value,
        most-requested CSV reports.
      </div>
    </div>
  );
};
