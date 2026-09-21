import React, { useMemo, useState } from 'react';
import {
  UserPlus,
  Stethoscope,
  Clock,
  TestTube,
  ClipboardList,
  Pill,
  CheckCircle2,
  Activity,
  BedDouble,
  ArrowLeftRight,
  LogOut,
  IndianRupee,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { PatientHistoryReport, PatientTimelineEvent, PatientTimelineEventType } from '../../api/patient-history.api';

const EVENT_ICONS: Record<PatientTimelineEventType, React.ComponentType<{ className?: string }>> = {
  REGISTRATION: UserPlus,
  VISIT: Stethoscope,
  QUEUE: Clock,
  CONSULTATION: Stethoscope,
  LAB_ORDER: TestTube,
  LAB_RESULT: ClipboardList,
  PRESCRIPTION: Pill,
  MEDICINE_DISPENSED: CheckCircle2,
  PROCEDURE: Activity,
  THERAPY_SESSION: Activity,
  ADMISSION: BedDouble,
  BED_MOVEMENT: ArrowLeftRight,
  PROGRESS_NOTE: FileText,
  DISCHARGE: LogOut,
  PAYMENT: IndianRupee,
};

const EVENT_LABELS: Record<PatientTimelineEventType, string> = {
  REGISTRATION: 'Registration',
  VISIT: 'Visit',
  QUEUE: 'Queue',
  CONSULTATION: 'Consultation',
  LAB_ORDER: 'Lab Order',
  LAB_RESULT: 'Lab Result',
  PRESCRIPTION: 'Prescription',
  MEDICINE_DISPENSED: 'Medicine Dispensed',
  PROCEDURE: 'Procedure',
  THERAPY_SESSION: 'Therapy',
  ADMISSION: 'Admission',
  BED_MOVEMENT: 'Bed Movement',
  PROGRESS_NOTE: 'Progress Note',
  DISCHARGE: 'Discharge',
  PAYMENT: 'Payment',
};

function formatEventDateTime(timestamp: string | null, timeRecorded: boolean): { date: string; time: string } {
  if (!timestamp || !timeRecorded) return { date: '—', time: 'Time not recorded' };
  const d = new Date(timestamp);
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

function dayKey(timestamp: string | null): string {
  if (!timestamp) return 'unknown';
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Renders one event's `details` payload as readable key/value lines -- generic over every event type rather than a bespoke renderer per type, since the shape is already flat/JSON-friendly from the backend. */
function EventDetails({ event }: { event: PatientTimelineEvent }) {
  const d = event.details as Record<string, any>;

  if (event.type === 'PRESCRIPTION' && Array.isArray(d.items)) {
    return (
      <div className="space-y-1.5">
        {d.items.map((it: any, i: number) => (
          <div key={i} className="flex items-center justify-between bg-white p-1.5 rounded border border-[var(--color-border)] text-[11px]">
            <span className="font-semibold flex items-center gap-1.5">
              {it.medicineName}
              {it.medicineType === 'CUSTOM' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Custom</span>}
            </span>
            <span className="text-[var(--color-text-secondary)] font-mono">{it.dose} · {it.frequency} · {it.duration}</span>
          </div>
        ))}
      </div>
    );
  }

  if (event.type === 'MEDICINE_DISPENSED' && Array.isArray(d.items)) {
    return (
      <div className="space-y-1.5">
        {d.items.map((it: any, i: number) => (
          <div key={i} className="flex items-center justify-between bg-white p-1.5 rounded border border-[var(--color-border)] text-[11px]">
            <span className="font-semibold">{it.medicineName}</span>
            <span className="text-[var(--color-text-secondary)]">Qty: {it.quantity}</span>
          </div>
        ))}
      </div>
    );
  }

  if (event.type === 'LAB_ORDER' && Array.isArray(d.tests)) {
    return (
      <div className="space-y-1">
        {d.tests.map((t: any, i: number) => (
          <div key={i} className="text-[11px]">• {t.name} <span className="text-[var(--color-text-tertiary)]">({t.status})</span></div>
        ))}
        {d.sample && (
          <div className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
            Sample {d.sample.sampleCode} ({d.sample.specimenType}) collected {new Date(d.sample.collectedAt).toLocaleString('en-IN')}
          </div>
        )}
      </div>
    );
  }

  if (event.type === 'LAB_RESULT' && Array.isArray(d.results)) {
    return (
      <table className="w-full text-[10.5px]">
        <thead className="text-[var(--color-text-tertiary)]">
          <tr><th className="text-left font-semibold">Parameter</th><th className="text-left font-semibold">Result</th><th className="text-left font-semibold">Range</th></tr>
        </thead>
        <tbody>
          {d.results.map((r: any, i: number) => (
            <tr key={i} className={r.flag !== 'NORMAL' ? 'text-amber-700 font-semibold' : ''}>
              <td>{r.groupLabel ? `${r.groupLabel} — ` : ''}{r.parameter}</td>
              <td>{r.value} {r.unit ?? ''} {r.flag !== 'NORMAL' ? `(${r.flag})` : ''}</td>
              <td>{r.range ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (event.type === 'QUEUE') {
    return (
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {[
          ['Generated', d.generatedAt],
          ['Checked In', d.checkedInAt],
          ['Called', d.calledAt],
          ['Service Started', d.serviceStartedAt],
          ['Completed', d.completedAt],
          ['Closed', d.closedAt],
        ].map(([label, ts]) => (
          <div key={label as string}>
            <span className="text-[var(--color-text-tertiary)] block">{label}</span>
            <span className="font-mono">{ts ? new Date(ts as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
          </div>
        ))}
      </div>
    );
  }

  if (event.type === 'CONSULTATION') {
    return (
      <div className="space-y-1 text-[11px]">
        {d.chiefComplaint && <div><span className="text-[var(--color-text-tertiary)]">Chief Complaint: </span>{d.chiefComplaint}</div>}
        {d.clinicalNotes && <div><span className="text-[var(--color-text-tertiary)]">Clinical Notes: </span>{d.clinicalNotes}</div>}
        <div><span className="text-[var(--color-text-tertiary)]">Diagnosis: </span><strong>{d.diagnosis}</strong></div>
        {d.followUpFlag && <div className="text-primary-600">✓ Follow-up recommended</div>}
        {d.admissionRecommended && <div className="text-red-600">⚠ Admission recommended</div>}
      </div>
    );
  }

  if (event.type === 'BED_MOVEMENT') {
    const fmt = (loc: any) => (loc ? [loc.ward, loc.room && `Room ${loc.room}`, loc.bed && `Bed ${loc.bed}`].filter(Boolean).join(' · ') : '—');
    return (
      <div className="text-[11px] space-y-0.5">
        <div>{fmt(d.from)} → <strong>{fmt(d.to)}</strong></div>
        {d.reason && <div className="text-[var(--color-text-tertiary)]">Reason: {d.reason}</div>}
      </div>
    );
  }

  if (event.type === 'DISCHARGE') {
    return (
      <div className="text-[11px] space-y-0.5">
        {d.lengthOfStayDays !== null && <div>Length of stay: {d.lengthOfStayDays} day(s)</div>}
        {d.summary && <div className="text-[var(--color-text-secondary)]">{d.summary}</div>}
      </div>
    );
  }

  if (event.type === 'PROGRESS_NOTE') {
    return (
      <div className="text-[11px] space-y-1">
        {d.admissionNumber && (
          <div className="text-[10px] text-[var(--color-text-tertiary)] font-mono">Admission: {String(d.admissionNumber)}</div>
        )}
        <p className="whitespace-pre-wrap">{String(d.note ?? '—')}</p>
      </div>
    );
  }

  // Generic fallback: every other event type's details object is already flat key/value.
  const entries = Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-1 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k}>
          <span className="text-[var(--color-text-tertiary)] capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}: </span>
          <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

export const PatientClinicalTimeline: React.FC<{ report: PatientHistoryReport; onDownloadPdf?: () => void }> = ({ report }) => {
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const departments = useMemo(
    () => Array.from(new Set(report.events.map((e) => e.department).filter((d): d is string => !!d))).sort(),
    [report.events],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return report.events.filter((e) => {
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (deptFilter !== 'ALL' && e.department !== deptFilter) return false;
      if (dateFrom && e.timestamp && e.timestamp.slice(0, 10) < dateFrom) return false;
      if (dateTo && e.timestamp && e.timestamp.slice(0, 10) > dateTo) return false;
      if (q) {
        const haystack = `${e.title} ${e.department ?? ''} ${e.performedBy ?? ''} ${JSON.stringify(e.details)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [report.events, typeFilter, deptFilter, dateFrom, dateTo, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, PatientTimelineEvent[]>();
    for (const e of filtered) {
      const key = dayKey(e.timestamp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search timeline (medicine, doctor, department...)"
            className="input text-[11px] py-1.5 pl-7 w-full"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input text-[11px] py-1.5">
          <option value="ALL">All Event Types</option>
          {(Object.keys(EVENT_LABELS) as PatientTimelineEventType[]).map((t) => (
            <option key={t} value={t}>{EVENT_LABELS[t]}</option>
          ))}
        </select>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input text-[11px] py-1.5">
          <option value="ALL">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input text-[11px] py-1.5" />
        <span className="text-[var(--color-text-tertiary)]">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input text-[11px] py-1.5" />
      </div>

      <p className="text-[10px] text-[var(--color-text-tertiary)]">
        Showing {filtered.length} of {report.events.length} events
      </p>

      {/* Timeline */}
      <div className="max-h-[520px] overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] py-8 text-center">No events match these filters.</p>
        ) : (
          grouped.map(([day, dayEvents]) => (
            <div key={day} className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2 sticky top-0 bg-[var(--color-surface)] py-1">
                {day === 'unknown' ? 'Date not recorded' : new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <div className="relative pl-6 space-y-3 border-l-2 border-primary-100 ml-2">
                {dayEvents.map((event) => {
                  const Icon = EVENT_ICONS[event.type];
                  const { time } = formatEventDateTime(event.timestamp, event.timeRecorded);
                  const isExpanded = expandedId === event.id;
                  return (
                    <div key={event.id} className="relative">
                      <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-primary-500 flex items-center justify-center">
                        <Icon className="w-2.5 h-2.5 text-primary-600" />
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : event.id)}
                        className="w-full text-left bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg border border-[var(--color-border)] p-2.5 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="neutral">{EVENT_LABELS[event.type]}</Badge>
                            <span className="font-semibold text-xs truncate">{event.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">{time}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--color-text-secondary)]">
                          <span>{event.department ?? event.location ?? ''}</span>
                          <span>{event.performedBy ? `${event.performedBy}${event.performedByRole ? ` (${event.performedByRole})` : ''}` : ''}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="mt-1.5 p-2.5 bg-white rounded-lg border border-[var(--color-border)]">
                          <EventDetails event={event} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
