import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPharmacyQueue,
  fetchBatchOptions,
  dispenseMedicines,
  PharmacyQueueRecord,
  MedicineBatchOption,
} from '../../api/pharmacy.api';

interface PharmacyQueueScreenProps {
  authToken: string;
}

export const PharmacyQueueScreen: React.FC<PharmacyQueueScreenProps> = ({ authToken }) => {
  const [queue, setQueue] = useState<PharmacyQueueRecord[]>([]);
  const [selectedRx, setSelectedRx] = useState<PharmacyQueueRecord | null>(null);
  const [batchOptions, setBatchOptions] = useState<Record<string, MedicineBatchOption[]>>({});
  const [selectedBatches, setSelectedBatches] = useState<Record<string, string>>({});
  const [dispenseQtyMap, setDispenseQtyMap] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(false);
  const [dispensing, setDispensing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedRxRef = useRef<PharmacyQueueRecord | null>(null);
  useEffect(() => {
    selectedRxRef.current = selectedRx;
  }, [selectedRx]);

  const handleSelectRx = useCallback(
    async (rx: PharmacyQueueRecord) => {
      setSelectedRx(rx);
      setError(null);
      setSuccessMessage(null);
      try {
        const batches = await fetchBatchOptions(rx.id, authToken);
        setBatchOptions(batches);

        // Pre-select top FEFO batch for each item
        const initialBatches: Record<string, string> = {};
        const initialQty: Record<string, number> = {};

        rx.items.forEach((item) => {
          const itemBatches = batches[item.id] || [];
          if (itemBatches.length > 0) {
            initialBatches[item.id] = itemBatches[0].id; // Top FEFO batch
          }
          initialQty[item.id] = 1;
        });

        setSelectedBatches(initialBatches);
        setDispenseQtyMap(initialQty);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load FEFO batch options');
      }
    },
    [authToken],
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPharmacyQueue(authToken);
      setQueue(data);
      if (data.length > 0 && !selectedRxRef.current) {
        handleSelectRx(data[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pharmacy queue');
    } finally {
      setLoading(false);
    }
  }, [authToken, handleSelectRx]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleDispense = async () => {
    if (!selectedRx) return;

    setError(null);
    setSuccessMessage(null);
    setDispensing(true);

    const itemsToDispense = selectedRx.items
      .filter((item) => selectedBatches[item.id])
      .map((item) => ({
        prescriptionItemId: item.id,
        medicineBatchId: selectedBatches[item.id],
        dispenseQuantity: dispenseQtyMap[item.id] || 1,
      }));

    if (itemsToDispense.length === 0) {
      setError('Please select a valid FEFO batch for at least one item.');
      setDispensing(false);
      return;
    }

    try {
      await dispenseMedicines(selectedRx.id, itemsToDispense, authToken);
      setSuccessMessage(
        `✅ Successfully dispensed medicines for Patient ${selectedRx.visit.patientProfile.fullName}! Stock updated atomically.`,
      );
      loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dispensing failed');
    } finally {
      setDispensing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header Bar */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">
            💊 Pharmacy Dispensing & Inventory Workstation
          </h2>
          <p className="text-sm text-gray-500">
            System-enforced FEFO batch selection, Benefit Rule coverage check, and append-only stock
            audit.
          </p>
        </div>
        <button
          onClick={loadQueue}
          disabled={loading}
          className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold text-xs rounded-lg hover:bg-gray-200 transition-colors"
        >
          🔄 Refresh Queue
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-medium">
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prescription Queue List */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4 lg:col-span-1">
          <h3 className="font-bold text-gray-800 text-lg border-b pb-2 flex justify-between items-center">
            <span>Signed Rx Queue</span>
            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">
              {queue.length} Pending
            </span>
          </h3>

          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading queue...</div>
          ) : queue.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No signed prescriptions awaiting dispensing.
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map((rx) => (
                <div
                  key={rx.id}
                  onClick={() => handleSelectRx(rx)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedRx?.id === rx.id
                      ? 'border-esic-primary bg-blue-50/50 shadow-sm'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-gray-900 text-sm">
                      {rx.visit.patientProfile.fullName}
                    </span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                      {rx.visit.patientProfile.employee.employmentType.code}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono mb-2">
                    UID: {rx.visit.patientProfile.hospitalUid} | Visit: {rx.visitId}
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400">
                      {new Date(rx.signedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="font-semibold text-esic-primary">
                      {rx.items.length} Medicines Prescribed →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Prescription Dispensing Panel */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6 lg:col-span-2">
          {selectedRx ? (
            <>
              {/* Patient Banner */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Patient Context
                  </div>
                  <div className="text-lg font-bold text-gray-900">
                    {selectedRx.visit.patientProfile.fullName}
                  </div>
                  <div className="text-xs text-gray-600 font-mono">
                    Emp ID: {selectedRx.visit.patientProfile.employee.employeeId} | UID:{' '}
                    {selectedRx.visit.patientProfile.hospitalUid}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      selectedRx.visit.patientProfile.employee.employmentType.code === 'CONTRACTUAL'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}
                  >
                    {selectedRx.visit.patientProfile.employee.employmentType.code === 'CONTRACTUAL'
                      ? '💳 CONTRACTUAL (PAID)'
                      : '🏥 PERMANENT (ESIC COVERED)'}
                  </span>
                </div>
              </div>

              {/* Items Breakdown with FEFO Selection */}
              <div className="space-y-4">
                <h4 className="font-bold text-gray-800 text-base border-b pb-2">
                  Prescribed Medicines & FEFO Batch Allocation
                </h4>

                <div className="space-y-4">
                  {selectedRx.items.map((item) => {
                    const options = batchOptions[item.id] || [];
                    const selectedBatchId = selectedBatches[item.id] || '';
                    const chosenBatch = options.find((b) => b.id === selectedBatchId);

                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl border border-gray-200 bg-white space-y-3 shadow-sm"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-gray-900 text-base">
                              {item.medicineName}
                            </span>
                            <span className="ml-2 text-xs font-medium text-gray-500">
                              ({item.dose} • {item.frequency} • {item.duration})
                            </span>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded text-xs font-bold border ${
                              item.benefitOutcome === 'PAID' ||
                              selectedRx.visit.patientProfile.employee.employmentType.code ===
                                'CONTRACTUAL'
                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            }`}
                          >
                            {selectedRx.visit.patientProfile.employee.employmentType.code ===
                            'CONTRACTUAL'
                              ? '💳 PAID OUT OF POCKET'
                              : '🏥 COVERED BY ESIC'}
                          </span>
                        </div>

                        {/* FEFO Batch Dropdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-bold text-gray-400 block uppercase mb-1">
                              FEFO Usable Batch (Earliest Expiry First):
                            </label>
                            {options.length > 0 ? (
                              <select
                                value={selectedBatchId}
                                onChange={(e) =>
                                  setSelectedBatches({
                                    ...selectedBatches,
                                    [item.id]: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded text-xs font-mono font-semibold text-gray-800 focus:ring-2 focus:ring-esic-primary"
                              >
                                {options.map((batch, idx) => (
                                  <option key={batch.id} value={batch.id}>
                                    {idx === 0 ? '⭐ [TOP FEFO] ' : ''}
                                    Batch #{batch.batchNumber} | Exp:{' '}
                                    {new Date(batch.expiryDate).toLocaleDateString()} | Stock:{' '}
                                    {batch.currentStock} units
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="p-2 bg-red-50 text-red-700 text-xs font-semibold rounded border border-red-200">
                                ⚠️ No unexpired batch available in stock!
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="text-[10px] font-bold text-gray-400 block uppercase mb-1">
                              Dispense Qty:
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={chosenBatch?.currentStock || 100}
                              value={dispenseQtyMap[item.id] || 1}
                              onChange={(e) =>
                                setDispenseQtyMap({
                                  ...dispenseQtyMap,
                                  [item.id]: parseInt(e.target.value) || 1,
                                })
                              }
                              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded text-xs font-semibold text-gray-800"
                            />
                          </div>
                        </div>

                        {chosenBatch && (
                          <div className="text-[11px] text-gray-500 font-mono bg-gray-50 p-2 rounded flex justify-between">
                            <span>Mfr: {chosenBatch.manufacturer}</span>
                            <span>Unit Price: ₹{chosenBatch.issuePrice}</span>
                            <span className="font-bold text-emerald-700">
                              Status: {chosenBatch.stockStatus}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t flex justify-end">
                <button
                  type="button"
                  onClick={handleDispense}
                  disabled={dispensing}
                  className="px-6 py-2.5 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 transition-colors shadow-md disabled:opacity-50 flex items-center space-x-2"
                >
                  <span>💊</span>
                  <span>
                    {dispensing
                      ? 'Dispensing & Deducting Stock...'
                      : 'Dispense Prescription & Deduct Stock'}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-400">
              Select a signed prescription from the queue to start dispensing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
