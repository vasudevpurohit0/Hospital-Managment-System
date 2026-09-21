import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { MedicationHistoryRow, PatientHistoryReport } from '../../api/patient-history.api';

const STAGE_LABEL: Record<MedicationHistoryRow['stage'], string> = {
  PRESCRIBED: 'Prescribed',
  DISPENSED: 'Dispensed',
  ADMINISTERED: 'Administered',
};

const STAGE_BADGE: Record<MedicationHistoryRow['stage'], 'info' | 'success' | 'neutral'> = {
  PRESCRIBED: 'info',
  DISPENSED: 'success',
  ADMINISTERED: 'neutral',
};

function formatWhen(row: MedicationHistoryRow): string {
  if (!row.timestamp || !row.timeRecorded) return 'Not recorded';
  return new Date(row.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The dedicated Medication History view (Feature #28): answers "what was
 * prescribed / dispensed / administered, when, and by whom" as one flat,
 * filterable table -- every row is a real record or an explicit "Not
 * recorded", never inferred from another stage.
 */
export const PatientMedicationHistory: React.FC<{ report: PatientHistoryReport }> = ({ report }) => {
  const [stageFilter, setStageFilter] = useState<'ALL' | MedicationHistoryRow['stage']>('ALL');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return report.medicationHistory
      .filter((r) => (stageFilter === 'ALL' ? true : r.stage === stageFilter))
      .filter((r) => (q ? r.medicineName.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : Infinity;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : Infinity;
        return ta - tb;
      });
  }, [report.medicationHistory, stageFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search medicine name..."
            className="input text-[11px] py-1.5 pl-7 w-full"
          />
        </div>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)} className="input text-[11px] py-1.5">
          <option value="ALL">All Stages</option>
          <option value="PRESCRIBED">Prescribed</option>
          <option value="DISPENSED">Dispensed</option>
          <option value="ADMINISTERED">Administered</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-b border-[var(--color-border)] font-semibold">
            <tr>
              <th className="p-2 pl-3">Date &amp; Time</th>
              <th className="p-2">Medicine</th>
              <th className="p-2">Event</th>
              <th className="p-2">Dose / Frequency / Duration</th>
              <th className="p-2">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-[var(--color-text-tertiary)]">
                  No medication events match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={!row.timeRecorded ? 'opacity-70' : ''}>
                  <td className="p-2 pl-3 font-mono whitespace-nowrap">{formatWhen(row)}</td>
                  <td className="p-2 font-medium">
                    {row.medicineName}
                    {row.medicineType === 'CUSTOM' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Custom</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Badge variant={STAGE_BADGE[row.stage]}>{STAGE_LABEL[row.stage]}</Badge>
                  </td>
                  <td className="p-2">
                    {row.stage === 'DISPENSED' && row.quantity !== null
                      ? `Qty: ${row.quantity}`
                      : [row.dose, row.frequency, row.duration].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="p-2">
                    {row.by ?? (row.notRecordedReason ? <span className="text-[var(--color-text-tertiary)] italic">Not recorded</span> : '—')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
