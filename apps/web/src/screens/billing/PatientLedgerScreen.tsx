import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchPatientLedger,
  cancelCharge,
  issueReceipt,
  downloadReceiptPdf,
  downloadStatementPdf,
  fetchTotalPatientExpenses,
  exportPatientExpenseReportExcel,
  PatientLedger,
  ExpensePeriod,
} from '../../api/ledger.api';
import { searchPatients } from '../../api/patient.api';
import { formatDateDDMonYYYY } from '../../utils/date';

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'] as const;

interface PatientLedgerScreenProps {
  authToken: string;
}

const rupees = (amount: string): string =>
  `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const statusBadge = (status: string): string => {
  switch (status) {
    case 'PAID':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'PENDING':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-500 border-gray-200 line-through';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

/**
 * Feature 4 — a patient's complete financial history, looked up by either
 * Employee ID or UHID.
 *
 * Every line is Date | Service | Category | Quantity | Rate | Total, where
 * Total is quantity × the rate configured in Service Pricing. There is no
 * discount in this system, and no benefit or coverage adjustment reduces a
 * total, so no such column or tile is shown.
 */
export const PatientLedgerScreen: React.FC<PatientLedgerScreenProps> = ({ authToken }) => {
  const [query, setQuery] = useState('');
  const [ledger, setLedger] = useState<PatientLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  /**
   * Bug fix: this screen could show a patient's real outstanding balance
   * (Lab, Therapy, OPD charges all correctly posted PENDING) but had no way
   * to actually collect it — issueReceipt() existed in ledger.api.ts and was
   * never called from anywhere in the UI. Only Pharmacy auto-receipts at
   * dispense time, so every other service's "payment → receipt" step of the
   * chain was a dead end reachable only via direct API calls.
   */
  const [selectedChargeIds, setSelectedChargeIds] = useState<Set<string>>(new Set());
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODES)[number]>('CASH');
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ id: string; receiptNumber: string; totalAmount: string } | null>(null);

  // Period filter for Total Patient Expenses (All Patients)
  const [selectedPeriod, setSelectedPeriod] = useState<ExpensePeriod>('1_WEEK');
  const [totalExpenses, setTotalExpenses] = useState<string>('0');
  const [totalExpensesLoading, setTotalExpensesLoading] = useState(false);
  const [totalExpensesError, setTotalExpensesError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Bug fix: this screen used to show nothing but an empty search box until
   * someone typed an exact Employee ID/UHID — with no way to see who exists
   * or browse to a patient by name. It now lists every registered patient
   * up front (reusing the same broad search endpoint Patient Search uses),
   * so staff can see and open any patient's ledger without knowing their ID
   * in advance.
   */
  const [allPatients, setAllPatients] = useState<
    { id: string; name: string; hospitalUid: string; employeeId: string; mobile: string; department: string; currentStatus: string }[]
  >([]);
  const [allPatientsLoading, setAllPatientsLoading] = useState(false);
  const [allPatientsError, setAllPatientsError] = useState<string | null>(null);

  const loadAllPatients = useCallback(async () => {
    setAllPatientsLoading(true);
    setAllPatientsError(null);
    try {
      const res = await searchPatients({ limit: 50 }, authToken);
      setAllPatients(res?.items || []);
    } catch (err) {
      setAllPatientsError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllPatientsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    loadAllPatients();
  }, [loadAllPatients]);

  const handleExportExcel = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportPatientExpenseReportExcel(selectedPeriod, authToken);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    setTotalExpensesLoading(true);
    setTotalExpensesError(null);
    fetchTotalPatientExpenses(selectedPeriod, authToken)
      .then((res) => {
        if (isMounted) setTotalExpenses(res.totalAmount);
      })
      .catch((err) => {
        if (isMounted) setTotalExpensesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setTotalExpensesLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedPeriod, authToken]);

  const search = useCallback(
    async (identifier: string) => {
      if (!identifier.trim()) return;
      setLoading(true);
      setError(null);
      try {
        setLedger(await fetchPatientLedger(identifier.trim(), authToken));
      } catch (err) {
        setLedger(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSearch = params.get('search') || params.get('employeeId');
    if (initialSearch) {
      setQuery(initialSearch);
      search(initialSearch);
    }
  }, [search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSelectedChargeIds(new Set());
    setLastReceipt(null);
    setCollectError(null);
    search(query);
  };

  const submitCancel = async () => {
    if (!cancelling) return;
    if (cancelReason.trim().length < 3) {
      setCancelError('Give a reason for cancelling this charge.');
      return;
    }
    try {
      await cancelCharge(cancelling, cancelReason.trim(), authToken);
      setCancelling(null);
      setCancelReason('');
      setCancelError(null);
      await search(query);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleChargeSelection = (chargeId: string) => {
    setSelectedChargeIds((prev) => {
      const next = new Set(prev);
      if (next.has(chargeId)) next.delete(chargeId);
      else next.add(chargeId);
      return next;
    });
  };

  const pendingCharges = ledger?.transactions.filter((t) => t.status === 'PENDING') ?? [];
  const selectedTotal = pendingCharges
    .filter((t) => selectedChargeIds.has(t.id))
    .reduce((sum, t) => sum + Number(t.totalAmount), 0);

  const toggleSelectAllPending = () => {
    setSelectedChargeIds((prev) =>
      prev.size === pendingCharges.length ? new Set() : new Set(pendingCharges.map((t) => t.id)),
    );
  };

  const submitCollectPayment = async () => {
    if (selectedChargeIds.size === 0) return;
    setCollecting(true);
    setCollectError(null);
    try {
      const receipt = await issueReceipt(Array.from(selectedChargeIds), paymentMode, authToken);
      setLastReceipt({ id: receipt.id, receiptNumber: receipt.receiptNumber, totalAmount: receipt.totalAmount });
      setSelectedChargeIds(new Set());
      await search(query);
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-4 sm:p-6 space-y-6">
      <div className="pb-4 border-b border-gray-200">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Patient Financial Ledger</h2>
        <p className="text-sm text-gray-500">
          Every billable activity for one patient, across OPD, IPD, pharmacy and every other
          service — each charged at quantity × its configured service rate.
        </p>
      </div>

      {/* Total Patient Expenses Section */}
      <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Total Patient Expenses
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            {totalExpensesLoading ? (
              <span className="text-xl sm:text-2xl font-bold text-gray-400 animate-pulse">Loading…</span>
            ) : totalExpensesError ? (
              <span className="text-sm text-red-600 font-medium">Failed to load: {totalExpensesError}</span>
            ) : (
              <span className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">
                {rupees(totalExpenses)}
              </span>
            )}
            <span className="text-xs text-gray-500">
              (All patients · {selectedPeriod === '1_WEEK' ? 'Past 7 days' : selectedPeriod === '15_DAYS' ? 'Past 15 days' : 'Past 30 days'})
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {(
              [
                { id: '1_WEEK', label: '1 Week' },
                { id: '15_DAYS', label: '15 Days' },
                { id: '1_MONTH', label: '1 Month' },
              ] as const
            ).map((period) => {
              const isActive = selectedPeriod === period.id;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => setSelectedPeriod(period.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-white text-gray-900 shadow-sm font-semibold border border-gray-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  {period.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors shadow-sm disabled:opacity-50"
            title="Download detailed patient expense report in Excel format for the selected period"
          >
            {exporting ? 'Exporting…' : 'Export Patient Expense Report (Excel)'}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
          {exportError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Employee ID (EMP-1001) or UHID (ESIC-2026-000001)"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-esic-primary disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {!ledger && (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">All Patients ({allPatients.length})</h3>
            <p className="text-xs text-gray-500">Click a patient to open their ledger</p>
          </div>
          {allPatientsError && (
            <div className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-xs">{allPatientsError}</div>
          )}
          {allPatientsLoading ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">Loading patients…</p>
          ) : allPatients.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No patients registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">UHID</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Employee ID</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Department</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Mobile</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allPatients.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => {
                        const identifier = p.hospitalUid !== '—' ? p.hospitalUid : p.employeeId;
                        setQuery(identifier);
                        search(identifier);
                      }}
                      className="hover:bg-primary-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{p.hospitalUid}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{p.employeeId}</td>
                      <td className="px-4 py-2.5 text-gray-600">{p.department}</td>
                      <td className="px-4 py-2.5 text-gray-600">{p.mobile}</td>
                      <td className="px-4 py-2.5 text-gray-600">{p.currentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {ledger && (
        <>
          <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
            <div>
              <div className="font-bold text-gray-900 text-lg">{ledger.name}</div>
              <div className="text-sm text-gray-500 font-mono">
                {ledger.uhid ?? '—'} · {ledger.employeeId}
              </div>
            </div>
            <button
              onClick={() => downloadStatementPdf(ledger.employeeId, authToken)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-esic-primary text-esic-primary hover:bg-esic-primary/5"
            >
              📄 Download Statement PDF
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Charges', value: ledger.summary.totalAmount, tone: 'text-gray-900' },
              { label: 'Paid', value: ledger.summary.paidAmount, tone: 'text-green-700' },
              {
                label: 'Outstanding',
                value: ledger.summary.outstandingAmount,
                tone: Number(ledger.summary.outstandingAmount) > 0 ? 'text-red-700' : 'text-gray-500',
              },
            ].map((tile) => (
              <div key={tile.label} className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {tile.label}
                </div>
                <div className={`mt-1 text-xl font-bold tabular-nums ${tile.tone}`}>
                  {rupees(tile.value)}
                </div>
              </div>
            ))}
          </div>

          {lastReceipt && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
              <p className="text-sm text-green-800">
                ✅ Receipt <strong className="font-mono">{lastReceipt.receiptNumber}</strong> issued for{' '}
                {rupees(lastReceipt.totalAmount)}.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadReceiptPdf(lastReceipt.id, lastReceipt.receiptNumber, authToken)}
                  className="text-sm font-semibold text-green-800 hover:underline"
                >
                  Download PDF
                </button>
                <button onClick={() => setLastReceipt(null)} className="text-green-600 hover:text-green-800">
                  ×
                </button>
              </div>
            </div>
          )}

          {pendingCharges.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-amber-900">
                  <strong>{selectedChargeIds.size}</strong> of {pendingCharges.length} pending charge(s) selected
                  {selectedChargeIds.size > 0 && (
                    <span className="font-semibold"> — {rupees(String(selectedTotal))}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as (typeof PAYMENT_MODES)[number])}
                    className="px-3 py-1.5 border border-amber-300 rounded-lg text-sm bg-white"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={submitCollectPayment}
                    disabled={selectedChargeIds.size === 0 || collecting}
                    className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                  >
                    {collecting ? 'Collecting…' : `Collect Payment & Issue Receipt`}
                  </button>
                </div>
              </div>
              {collectError && <p className="text-sm text-red-600">{collectError}</p>}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3">
                      {pendingCharges.length > 0 && (
                        <input
                          type="checkbox"
                          checked={selectedChargeIds.size > 0 && selectedChargeIds.size === pendingCharges.length}
                          onChange={toggleSelectAllPending}
                          title="Select all pending charges"
                        />
                      )}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Service</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Category</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Quantity</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Rate</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Total</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Receipt</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ledger.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                        No billable activity recorded for this patient yet.
                      </td>
                    </tr>
                  ) : (
                    ledger.transactions.map((t) => (
                      <tr key={t.id} className={t.status === 'CANCELLED' ? 'opacity-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-3">
                          {t.status === 'PENDING' && (
                            <input
                              type="checkbox"
                              checked={selectedChargeIds.has(t.id)}
                              onChange={() => toggleChargeSelection(t.id)}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDateDDMonYYYY(t.date)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{t.service}</td>
                        <td className="px-4 py-3 text-gray-600">{t.category}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{rupees(t.rate)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                          {rupees(t.totalAmount)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs border ${statusBadge(t.status)}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">
                          {t.receiptId && t.receiptNumber ? (
                            <button
                              onClick={() => downloadReceiptPdf(t.receiptId!, t.receiptNumber!, authToken)}
                              className="text-esic-primary hover:underline"
                              title="Download receipt PDF"
                            >
                              {t.receiptNumber}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {t.status === 'PENDING' && (
                            <button
                              onClick={() => {
                                setCancelling(t.id);
                                setCancelReason('');
                                setCancelError(null);
                              }}
                              className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {cancelling && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Cancel charge</h3>
            <p className="text-sm text-gray-500">
              This voids the charge before any payment is collected. A charge already paid cannot
              be cancelled here.
            </p>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancelling"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            {cancelError && <p className="text-sm text-red-600">{cancelError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelling(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white"
              >
                Back
              </button>
              <button
                onClick={submitCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600"
              >
                Cancel charge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
