import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchExpiringBatches,
  triggerDailyExpiryScan,
  quarantineBatch,
  disposeBatch,
  MedicineBatchRecord,
} from '../../api/inventory.api';

interface ExpiryManagementScreenProps {
  authToken?: string;
  token?: string;
}

export const ExpiryManagementScreen: React.FC<ExpiryManagementScreenProps> = ({
  authToken,
  token,
}) => {
  const activeToken = authToken || token || '';
  const [batches, setBatches] = useState<MedicineBatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'EXPIRING' | 'QUARANTINED' | 'DISPOSED'>('EXPIRING');

  // Disposal Modal
  const [showDisposeModal, setShowDisposeModal] = useState(false);
  const [selectedBatchForDispose, setSelectedBatchForDispose] =
    useState<MedicineBatchRecord | null>(null);
  const [disposalReason, setDisposalReason] = useState('Expired past safe usage threshold');
  const [disposalNotes, setDisposalNotes] = useState('');

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExpiringBatches(90, activeToken);
      setBatches(data);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load expiring batches');
    } finally {
      setLoading(false);
    }
  }, [activeToken]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const handleRunScan = async () => {
    setLoading(true);
    setScanResult(null);
    try {
      const res = await triggerDailyExpiryScan(activeToken);
      setScanResult(
        `Scan Complete: ${res.quarantinedCount} Quarantined (Expired), ${res.criticalCount} Critical Alert (≤30d), ${res.earlyCount} Early Warning (≤90d).`,
      );
      loadBatches();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to execute expiry scan');
    } finally {
      setLoading(false);
    }
  };

  const handleQuarantine = async (batchId: string) => {
    try {
      await quarantineBatch(batchId, 'Manual quarantine by Store Manager', activeToken);
      loadBatches();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error quarantining batch');
    }
  };

  const handleExecuteDisposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchForDispose) return;
    try {
      await disposeBatch(
        selectedBatchForDispose.id,
        {
          disposalReason,
          notes: disposalNotes || undefined,
        },
        activeToken,
      );
      setShowDisposeModal(false);
      setSelectedBatchForDispose(null);
      setDisposalReason('Expired past safe usage threshold');
      setDisposalNotes('');
      loadBatches();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error executing disposal approval');
    }
  };

  const filteredBatches = batches.filter((b) => {
    if (filterTab === 'EXPIRING') {
      return (
        b.stockStatus === 'IN_STOCK' ||
        b.stockStatus === 'EARLY_WARNING' ||
        b.stockStatus === 'CRITICAL_ALERT'
      );
    }
    if (filterTab === 'QUARANTINED') {
      return b.stockStatus === 'EXPIRED' || b.stockStatus === 'QUARANTINED';
    }
    if (filterTab === 'DISPOSED') {
      return b.stockStatus === 'DISPOSED';
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>⏰</span> Expiry & FEFO Automation Workstation
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Store Manager Console • Daily Scheduled Scan Engine & Approved Stock Disposal Workflow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunScan}
            disabled={loading}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-2"
          >
            <span>⚡</span> Run Daily Expiry Scan
          </button>
          <button
            onClick={loadBatches}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Scan Outcome Banner */}
      {scanResult && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center justify-between text-purple-900 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span>{scanResult}</span>
          </div>
          <button
            onClick={() => setScanResult(null)}
            className="text-purple-400 hover:text-purple-700"
          >
            ✖
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterTab('EXPIRING')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filterTab === 'EXPIRING'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            ⚠️ Expiring Soon (≤90d / ≤30d)
          </button>
          <button
            onClick={() => setFilterTab('QUARANTINED')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filterTab === 'QUARANTINED'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            ⛔ Expired & Quarantined
          </button>
          <button
            onClick={() => setFilterTab('DISPOSED')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filterTab === 'DISPOSED'
                ? 'bg-gray-800 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            🗑️ Disposed Batches
          </button>
        </div>
        <div className="text-xs text-gray-500 font-medium">
          Showing <strong>{filteredBatches.length}</strong> batches
        </div>
      </div>

      {/* Batches Table */}
      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-500">
          Scanning inventory expiry dates...
        </div>
      ) : error ? (
        <div className="text-center py-8 bg-red-50 text-red-600 rounded-xl border border-red-200">
          ❌ {error}
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-400">
          No batches found under the selected status filter.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="p-3.5">Medicine</th>
                  <th className="p-3.5">Batch #</th>
                  <th className="p-3.5">Manufacturer</th>
                  <th className="p-3.5">Expiry Date</th>
                  <th className="p-3.5">Days to Expiry</th>
                  <th className="p-3.5">Current Stock</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBatches.map((batch) => {
                  const expiryDateObj = new Date(batch.expiryDate);
                  const now = new Date();
                  const diffDays = Math.ceil(
                    (expiryDateObj.getTime() - now.getTime()) / (1000 * 3600 * 24),
                  );

                  return (
                    <tr key={batch.id} className="hover:bg-gray-50/60 transition-all">
                      <td className="p-3.5 font-bold text-gray-900">
                        {batch.medicine?.genericName || 'Medicine'}
                        {batch.medicine?.brandName && (
                          <span className="block text-[11px] font-normal text-gray-500">
                            {batch.medicine.brandName}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-gray-800 font-semibold">
                        {batch.batchNumber}
                      </td>
                      <td className="p-3.5 text-gray-600">{batch.manufacturer}</td>
                      <td className="p-3.5 font-semibold text-gray-800">
                        {expiryDateObj.toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="p-3.5 font-bold">
                        {diffDays <= 0 ? (
                          <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded">
                            Expired ({Math.abs(diffDays)}d ago)
                          </span>
                        ) : diffDays <= 30 ? (
                          <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">
                            {diffDays} days left
                          </span>
                        ) : diffDays <= 90 ? (
                          <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                            {diffDays} days left
                          </span>
                        ) : (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            {diffDays} days left
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-bold text-gray-900">
                        {batch.currentStock}{' '}
                        <span className="text-gray-400 text-[10px]">units</span>
                      </td>
                      <td className="p-3.5">
                        {batch.stockStatus === 'EARLY_WARNING' && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold border border-amber-300">
                            ⚠️ Early Warning (≤90d)
                          </span>
                        )}
                        {batch.stockStatus === 'CRITICAL_ALERT' && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded font-semibold border border-red-300">
                            🚨 Critical Alert (≤30d)
                          </span>
                        )}
                        {batch.stockStatus === 'QUARANTINED' && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold border border-purple-300">
                            ⛔ Quarantined
                          </span>
                        )}
                        {batch.stockStatus === 'DISPOSED' && (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-semibold border border-gray-300">
                            🗑️ Disposed
                          </span>
                        )}
                        {batch.stockStatus === 'IN_STOCK' && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold border border-emerald-300">
                            🟢 In Stock
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right space-x-2">
                        {batch.stockStatus !== 'QUARANTINED' &&
                          batch.stockStatus !== 'DISPOSED' && (
                            <button
                              onClick={() => handleQuarantine(batch.id)}
                              className="px-2.5 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 rounded font-semibold text-xs transition-all"
                            >
                              Quarantine
                            </button>
                          )}
                        {batch.stockStatus !== 'DISPOSED' && (
                          <button
                            onClick={() => {
                              setSelectedBatchForDispose(batch);
                              setShowDisposeModal(true);
                            }}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold text-xs shadow-sm transition-all"
                          >
                            Approve Disposal
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Disposal Approval Modal */}
      {showDisposeModal && selectedBatchForDispose && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>🗑️</span> Approve Stock Disposal
              </h2>
              <button
                onClick={() => setShowDisposeModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-xs text-red-900">
              <p>
                <strong>Batch #:</strong> {selectedBatchForDispose.batchNumber}
              </p>
              <p>
                <strong>Medicine:</strong> {selectedBatchForDispose.medicine?.genericName}
              </p>
              <p>
                <strong>Units to Dispose:</strong> {selectedBatchForDispose.currentStock} units
              </p>
              <p className="text-[11px] text-red-700 italic pt-1">
                ⚠️ Executing disposal will reset current stock to 0, log a DISPOSAL transaction, and
                record a permanent audit log entry.
              </p>
            </div>

            <form onSubmit={handleExecuteDisposal} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Disposal Reason *
                </label>
                <input
                  type="text"
                  required
                  value={disposalReason}
                  onChange={(e) => setDisposalReason(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Additional Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Bio-hazard destruction certificate #8841"
                  value={disposalNotes}
                  onChange={(e) => setDisposalNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowDisposeModal(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
                >
                  Authorize & Dispose Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
