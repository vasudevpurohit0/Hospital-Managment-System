import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchLabQueue,
  fetchLabOrder,
  collectSample,
  enterLabResults,
  verifyLabOrder,
  downloadLabReportPdf,
  LabOrderRecord,
  LabOrderStatus,
} from '../../api/lab.api';
import { Badge } from '../../components/ui/Badge';
import { can } from '../../lib/permissions';
import { Microscope, RefreshCw, Package, Download, CheckCircle2, TestTube } from 'lucide-react';
import { formatDateTimeIN } from '../../utils/date';

interface LabWorkbenchScreenProps {
  authToken: string;
  userRole: string;
}

const STATUS_TABS: { id: LabOrderStatus | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All Active' },
  { id: 'ORDERED', label: 'Awaiting Collection' },
  { id: 'SAMPLE_COLLECTED', label: 'Collected' },
  { id: 'PROCESSING', label: 'In Progress' },
  { id: 'RESULT_ENTERED', label: 'Awaiting Verification' },
  { id: 'REPORTED', label: 'Reported' },
];

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'REPORTED') return 'success';
  if (status === 'CANCELLED') return 'danger';
  if (status === 'ORDERED') return 'neutral';
  return 'warning';
}

export const LabWorkbenchScreen: React.FC<LabWorkbenchScreenProps> = ({ authToken, userRole }) => {
  // Sourced from the shared RBAC mirror rather than an inline role list: the
  // inline version omitted SuperAdmin, which the sidebar routes here and the
  // server authorises, so the sample-collection step had no reachable action.
  const canCollect = can(userRole, 'lab:collectSample');
  const canEnterResults = can(userRole, 'lab:enterResults');
  const canVerify = can(userRole, 'lab:verifyReport');

  const [tab, setTab] = useState<LabOrderStatus | 'ALL'>('ALL');
  const [orders, setOrders] = useState<LabOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchLabQueue(authToken, tab === 'ALL' ? undefined : { status: tab });
      setOrders(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lab queue');
    } finally {
      setLoading(false);
    }
  }, [authToken, tab]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const loadDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setError(null);
      setMessage(null);
      setResultValues({});
      try {
        const d = await fetchLabOrder(id, authToken);
        setDetail(d);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order');
      }
    },
    [authToken],
  );

  const handleCollect = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await collectSample(selectedId, undefined, authToken);
      setMessage('Sample collected. The charge has been posted to the patient ledger.');
      await loadDetail(selectedId);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to collect sample');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveResults = async (labOrderItemId: string, parameterIds: string[]) => {
    const results = parameterIds
      .map((pid) => ({ parameterId: pid, value: resultValues[pid] ?? '' }))
      .filter((r) => r.value.trim() !== '');
    if (results.length === 0) {
      setError('Enter at least one result value before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await enterLabResults({ labOrderItemId, results }, authToken);
      setMessage('Results saved.');
      if (selectedId) await loadDetail(selectedId);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save results');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await verifyLabOrder(selectedId, remarks.trim() || undefined, authToken);
      setMessage('Report verified and released.');
      setRemarks('');
      await loadDetail(selectedId);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify report');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedId || !detail) return;
    setBusy(true);
    try {
      await downloadLabReportPdf(selectedId, detail.labNumber, authToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download report PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-6 bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 text-white border-none flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-secondary-300">
            <Microscope className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Laboratory Workbench</h1>
            <p className="text-xs text-primary-200/80 mt-0.5">
              Order → Sample Collection → Result Entry → Pathologist Verification → Report Release
            </p>
          </div>
        </div>
        <button onClick={loadQueue} className="btn btn-ghost btn-sm text-xs text-primary-200 hover:text-white gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger text-sm font-semibold">{error}</div>}
      {message && <div className="alert alert-success text-sm font-semibold">{message}</div>}

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              tab === t.id
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Queue List */}
        <div className="lg:col-span-5 card p-4 space-y-2 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-xs text-[var(--color-text-tertiary)] text-center py-8">Loading queue…</p>
          ) : orders.length === 0 ? (
            <div className="text-center py-10 text-[var(--color-text-tertiary)]">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs">No lab orders in this status.</p>
            </div>
          ) : (
            orders.map((o) => (
              <button
                key={o.id}
                onClick={() => loadDetail(o.id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  selectedId === o.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-primary-700">{o.labNumber ?? 'Pending No.'}</span>
                  <Badge variant={statusVariant(o.status)} className="text-[10px] px-1.5 py-0.5">
                    {o.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)] mt-1">
                  {o.visit?.employee.name} · {o.visit?.employee.employeeId}
                </p>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                  {o.items.map((i) => i.labTest.name).join(', ')}
                </p>
                {o.priority !== 'ROUTINE' && (
                  <Badge variant="danger" className="text-[9px] mt-1 px-1.5 py-0.5">
                    {o.priority}
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>

        {/* Detail / Action Panel */}
        <div className="lg:col-span-7 card p-5 space-y-4 min-h-[300px]">
          {!detail ? (
            <p className="text-xs text-[var(--color-text-tertiary)] text-center py-16">
              Select an order from the queue to view details.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                <div>
                  <h3 className="font-bold text-sm text-[var(--color-text-primary)] font-mono">
                    {detail.labNumber ?? 'Pending No.'}
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {detail.visit.employee.name} ({detail.visit.employee.employeeId}) · UHID{' '}
                    {detail.visit.employee.hospitalUid?.uidCode ?? '—'}
                  </p>
                </div>
                <Badge variant={statusVariant(detail.status)}>{detail.status.replace(/_/g, ' ')}</Badge>
              </div>

              {detail.status === 'ORDERED' && (
                <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] space-y-2">
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Specimen required: {detail.items[0]?.labTest.specimenType}
                  </p>
                  {canCollect ? (
                    <button onClick={handleCollect} disabled={busy} className="btn btn-primary btn-sm gap-2">
                      <TestTube className="w-4 h-4" /> Collect Sample
                    </button>
                  ) : (
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      Awaiting sample collection by Lab Technician.
                    </p>
                  )}
                </div>
              )}

              {(detail.status === 'SAMPLE_COLLECTED' || detail.status === 'PROCESSING') && (
                <div className="space-y-4">
                  {detail.items.map((item: any) => (
                    <div key={item.id} className="p-4 rounded-xl border border-[var(--color-border)] space-y-3">
                      <h4 className="text-sm font-bold text-[var(--color-text-primary)]">{item.labTest.name}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {item.labTest.parameters
                          .filter((p: any) => !p.isCalculated)
                          .map((p: any) => {
                            const existing = item.results?.find((r: any) => r.parameterId === p.id);
                            return (
                              <div key={p.id}>
                                <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] block mb-1">
                                  {p.name} {p.unit ? `(${p.unit})` : ''}
                                </label>
                                <input
                                  type="text"
                                  disabled={!canEnterResults}
                                  defaultValue={existing?.value ?? ''}
                                  onChange={(e) =>
                                    setResultValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                                  }
                                  className="input py-1 px-2 text-xs w-full"
                                  placeholder={p.ranges[0]?.displayText ?? 'Value'}
                                />
                              </div>
                            );
                          })}
                      </div>
                      {canEnterResults && (
                        <button
                          onClick={() =>
                            handleSaveResults(
                              item.id,
                              item.labTest.parameters.filter((p: any) => !p.isCalculated).map((p: any) => p.id),
                            )
                          }
                          disabled={busy}
                          className="btn btn-secondary btn-sm"
                        >
                          Save Results for {item.labTest.name}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {detail.status === 'RESULT_ENTERED' && (
                <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] space-y-3">
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Every test has results entered. A Pathologist must verify before the report releases.
                  </p>
                  {canVerify ? (
                    <>
                      <textarea
                        rows={2}
                        placeholder="Pathologist remarks (optional)..."
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        className="input text-xs w-full"
                      />
                      <button onClick={handleVerify} disabled={busy} className="btn btn-primary btn-sm gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Verify & Release Report
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      Awaiting verification by a Pathologist.
                    </p>
                  )}
                </div>
              )}

              {detail.status === 'REPORTED' && (
                <div className="p-4 rounded-xl bg-success-50 dark:bg-success-950/20 border border-success-200 dark:border-success-900 space-y-3">
                  <p className="text-xs text-success-700 dark:text-success-400 font-semibold">
                    Report released{detail.report?.verifiedAt ? ` on ${formatDateTimeIN(detail.report.verifiedAt)}` : ''}.
                  </p>
                  <button onClick={handleDownloadPdf} disabled={busy} className="btn btn-primary btn-sm gap-2">
                    <Download className="w-4 h-4" /> Download Report PDF
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
