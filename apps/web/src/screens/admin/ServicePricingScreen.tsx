import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchServiceCategories,
  fetchServices,
  fetchPriceHistory,
  setServicePrice,
  ServiceCategoryRecord,
  ServiceListItem,
  PriceHistory,
  ServiceType,
} from '../../api/catalog.api';
import { formatDateDDMonYYYY } from '../../utils/date';

interface ServicePricingScreenProps {
  authToken: string;
}

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  CONSULTATION: 'Consultation',
  TEST: 'Test',
  THERAPY: 'Therapy',
  PROCEDURE: 'Procedure',
  PACKAGE: 'Package',
  BED_DAY: 'Bed / day',
  CARE_PER_DAY: 'Care / day',
};

const UNIT_LABELS: Record<string, string> = {
  SITTING: 'per sitting',
  SESSION: 'per session',
  DAY: 'per day',
  COURSE: 'per course',
  TEST: 'per test',
  VISIT: 'per visit',
};

const rupees = (amount: string | null): string =>
  amount === null ? '—' : `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const shortDate = (iso: string | null): string => (iso ? formatDateDDMonYYYY(iso) : '—');

export const ServicePricingScreen: React.FC<ServicePricingScreenProps> = ({ authToken }) => {
  const [categories, setCategories] = useState<ServiceCategoryRecord[]>([]);
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  // Repricing dialog
  const [target, setTarget] = useState<ServiceListItem | null>(null);
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // History drawer
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await fetchServiceCategories(authToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [authToken]);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchServices(
        { search: search.trim() || undefined, categoryId: categoryId || undefined, unpricedOnly, page, limit },
        authToken,
      );
      setServices(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authToken, search, categoryId, unpricedOnly, page]);

  useEffect(() => {
    if (authToken) loadCategories();
  }, [authToken, loadCategories]);

  useEffect(() => {
    if (!authToken) return;
    const t = setTimeout(loadServices, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [authToken, loadServices, search]);

  const unpricedCount = useMemo(() => services.filter((s) => !s.isPriced).length, [services]);

  const openReprice = (service: ServiceListItem) => {
    setTarget(service);
    setAmount(service.currentPrice ?? '');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setReason('');
    setFormError(null);
  };

  const openHistory = async (service: ServiceListItem) => {
    setHistoryLoading(true);
    setHistory(null);
    try {
      setHistory(await fetchPriceHistory(service.id, authToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const submitPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFormError('Enter a valid amount in rupees.');
      return;
    }
    if (reason.trim().length < 3) {
      setFormError('Give a reason for this change — it is recorded in the price history.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await setServicePrice(
        target.id,
        {
          amount: parsed,
          effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
          reason: reason.trim(),
        },
        authToken,
      );
      setTarget(null);
      await loadServices();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-4 sm:p-6 space-y-6">
      <div className="flex justify-between items-start pb-4 border-b border-gray-200 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Service &amp; Pricing Master</h2>
          <p className="text-sm text-gray-500 max-w-3xl">
            Hospital rates for consultations, laboratory tests, therapies, procedures and packages.
            Changing a rate never alters a bill that has already been issued — the old rate is kept
            and the new one applies from its effective date onward.
          </p>
        </div>
        <button
          onClick={loadServices}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700 bg-white shadow-sm transition-all"
        >
          🔄 Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name or code…"
          className="flex-1 min-w-[240px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent"
        />
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.serviceCount})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 px-3 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer">
          <input
            type="checkbox"
            checked={unpricedOnly}
            onChange={(e) => {
              setUnpricedOnly(e.target.checked);
              setPage(1);
            }}
          />
          Needs a price
        </label>
      </div>

      {unpricedOnly && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          These services exist in the catalogue but have no rate. The reference material names them
          without publishing a price, so none was invented. They can be ordered as part of a package,
          but billing one on its own is refused until a rate is set here.
        </div>
      )}

      {/* ── Service table ── */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading services…</div>
      ) : services.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">No services match these filters.</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Service</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Setting</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Current rate</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Since</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {services.map((s) => (
                  <tr key={s.id} className={s.isPriced ? 'hover:bg-gray-50' : 'bg-amber-50/40 hover:bg-amber-50'}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{s.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{s.name}</div>
                      {s.sourceReference && (
                        <div className="text-xs text-gray-400 mt-0.5">{s.sourceReference}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{s.category}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200">
                        {SERVICE_TYPE_LABELS[s.serviceType]}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-xs border ${
                          s.applicability === 'OPD'
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : s.applicability === 'IPD'
                              ? 'bg-purple-100 text-purple-800 border-purple-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'
                        }`}
                      >
                        {s.applicability}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {s.isPriced ? (
                        <>
                          <span className="font-semibold text-gray-900">{rupees(s.currentPrice)}</span>
                          <span className="text-xs text-gray-400 ml-1">{UNIT_LABELS[s.unit] ?? ''}</span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Needs a price</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {shortDate(s.currentPriceEffectiveFrom)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openHistory(s)}
                        className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded mr-1"
                      >
                        History
                      </button>
                      <button
                        onClick={() => openReprice(s)}
                        className="px-3 py-1 text-xs font-medium text-white bg-esic-primary hover:opacity-90 rounded"
                      >
                        {s.isPriced ? 'Change rate' : 'Set rate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center text-sm text-gray-500">
        <span>
          {total} service{total === 1 ? '' : 's'}
          {unpricedCount > 0 && !unpricedOnly && ` · ${unpricedCount} on this page need a price`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 bg-white"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 bg-white"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* ── Repricing dialog ── */}
      {target && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={submitPrice}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4"
          >
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {target.isPriced ? 'Change rate' : 'Set rate'}
              </h3>
              <p className="text-sm text-gray-500">
                {target.name} <span className="font-mono text-xs">({target.code})</span>
              </p>
            </div>

            {target.isPriced && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                <span className="text-gray-500">Current rate</span>{' '}
                <span className="font-semibold text-gray-900">{rupees(target.currentPrice)}</span>{' '}
                <span className="text-gray-400 text-xs">
                  since {shortDate(target.currentPriceEffectiveFrom)}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                  New rate (₹)
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  autoFocus
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                  Effective from
                </span>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  required
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Reason</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="e.g. Annual revision per circular 12/2026"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <span className="text-xs text-gray-400">Recorded in the price history and audit log.</span>
            </label>

            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
              Bills already issued keep the old rate. Only charges raised on or after the effective
              date use the new one.
            </p>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-esic-primary disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save rate'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Price history ── */}
      {(history || historyLoading) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            {historyLoading ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading price history…</p>
            ) : (
              history && (
                <>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Price history</h3>
                      <p className="text-sm text-gray-500">
                        {history.serviceName}{' '}
                        <span className="font-mono text-xs">({history.serviceCode})</span>
                      </p>
                    </div>
                    <button
                      onClick={() => setHistory(null)}
                      className="text-gray-400 hover:text-gray-700 text-xl leading-none"
                      aria-label="Close price history"
                    >
                      ×
                    </button>
                  </div>

                  {history.versions.length === 0 ? (
                    <p className="text-sm text-gray-500 py-6">
                      This service has never been priced.
                    </p>
                  ) : (
                    <ol className="space-y-3">
                      {history.versions.map((v) => (
                        <li
                          key={v.id}
                          className={`p-3 rounded-lg border ${
                            v.isCurrent
                              ? 'border-green-200 bg-green-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}
                        >
                          <div className="flex justify-between items-baseline gap-3">
                            <span className="font-semibold text-gray-900 tabular-nums">
                              {rupees(v.amount)}
                            </span>
                            <span className="text-xs text-gray-500">
                              {shortDate(v.effectiveFrom)} →{' '}
                              {v.isCurrent ? 'current' : shortDate(v.effectiveTo)}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">{v.reason}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            {v.changedBy ? `Changed by ${v.changedBy}` : 'Seeded from reference material'}
                            {' · '}
                            {shortDate(v.changedAt)}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
