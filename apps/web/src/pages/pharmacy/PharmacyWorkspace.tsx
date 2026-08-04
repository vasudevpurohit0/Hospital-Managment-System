import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPharmacyQueue,
  fetchBatchOptions,
  dispenseMedicines,
  PharmacyQueueRecord,
  MedicineBatchOption,
} from '../../api/pharmacy.api';
import { Pill, Clock, User, Stethoscope, ShieldCheck } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';

interface PharmacyWorkspaceProps {
  authToken: string;
}

export const PharmacyWorkspace: React.FC<PharmacyWorkspaceProps> = ({ authToken }) => {
  const [queue, setQueue] = useState<PharmacyQueueRecord[]>([]);
  const [selectedRx, setSelectedRx] = useState<PharmacyQueueRecord | null>(null);
  const [batchOptions, setBatchOptions] = useState<Record<string, MedicineBatchOption[]>>({});
  const [selectedBatches, setSelectedBatches] = useState<Record<string, string>>({});
  const [dispenseQtyMap, setDispenseQtyMap] = useState<Record<string, number>>({});

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

        const initialBatches: Record<string, string> = {};
        const initialQty: Record<string, number> = {};

        rx.items.forEach((item) => {
          const itemBatches = batches[item.id] || [];
          if (itemBatches.length > 0) {
            initialBatches[item.id] = itemBatches[0].id;
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
    setError(null);
    try {
      const data = await fetchPharmacyQueue(authToken);
      setQueue(data);
      if (data.length > 0 && !selectedRxRef.current) {
        handleSelectRx(data[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pharmacy queue');
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
      .map((item) => ({
        prescriptionItemId: item.id,
        medicineBatchId: selectedBatches[item.id],
        dispenseQuantity: dispenseQtyMap[item.id] || 1,
      }))
      .filter((i) => i.medicineBatchId);

    if (itemsToDispense.length === 0) {
      setError('No valid FEFO batches selected for dispensing.');
      setDispensing(false);
      return;
    }

    try {
      const result = await dispenseMedicines(selectedRx.id, itemsToDispense, authToken);
      setSuccessMessage(
        `Dispensed ${result.dispensedItemsCount} items. Bill status: ${result.transactionOutcome}`,
      );
      loadQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dispensing failed');
    } finally {
      setDispensing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary-500/10 flex items-center justify-center text-secondary-600">
            <Pill className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              Pharmacy FEFO Dispensing Console
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Automated First-Expiry-First-Out batch selection workspace
            </p>
          </div>
        </div>

        <button onClick={loadQueue} className="btn btn-secondary btn-sm gap-2">
          <Clock className="w-3.5 h-3.5" /> Refresh Queue
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {successMessage && <div className="alert alert-success">{successMessage}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Queue List (4 cols) */}
        <div className="lg:col-span-4 card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
              Prescription Queue ({queue.length})
            </h3>
            <Badge variant="info">FEFO Active</Badge>
          </div>

          <div className="divide-y divide-[var(--color-border)] max-h-[550px] overflow-y-auto">
            {queue.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
                No pending prescriptions in queue.
              </div>
            ) : (
              queue.map((rx) => (
                <div
                  key={rx.id}
                  onClick={() => handleSelectRx(rx)}
                  className={`p-4 cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)] ${
                    selectedRx?.id === rx.id
                      ? 'bg-primary-50/70 border-l-4 border-primary-500 dark:bg-primary-950/30'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[var(--color-text-primary)]">
                      Rx #{rx.id.slice(-6)}
                    </span>
                    <Badge variant={rx.status === 'SIGNED' ? 'success' : 'warning'}>
                      {rx.status}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs space-y-1 text-[var(--color-text-secondary)]">
                    <p className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-primary-500" /> Patient:{' '}
                      {rx.visit?.employee?.name || 'Patient'}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-secondary-500" /> {rx.items.length}{' '}
                      Medicines prescribed
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Selected Rx FEFO Dispense Panel (8 cols) */}
        <div className="lg:col-span-8 card p-6 space-y-6">
          {selectedRx ? (
            <>
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-[var(--color-border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                      Dispense Prescription
                    </h3>
                    <Badge variant="info">Rx #{selectedRx.id}</Badge>
                  </div>
                </div>

                <Badge
                  variant={
                    selectedRx.visit?.employee?.employmentType?.code === 'CONTRACTUAL'
                      ? 'warning'
                      : 'success'
                  }
                  dot
                  className="px-3 py-1"
                >
                  {selectedRx.visit?.employee?.employmentType?.code === 'CONTRACTUAL'
                    ? 'Benefit Rule: Contractual (Paid)'
                    : 'Benefit Rule: ESIC Covered (100%)'}
                </Badge>
              </div>

              {/* Medicines List with FEFO Batches */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Prescribed Medicines & FEFO Batch Allocation
                </h4>

                {selectedRx.items.map((item) => {
                  const options = batchOptions[item.id] || [];
                  const selectedBatchId = selectedBatches[item.id] || '';

                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h5 className="font-bold text-sm text-[var(--color-text-primary)]">
                            {item.medicineName}
                          </h5>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            Dose: {item.dose} • Freq: {item.frequency} • Duration: {item.duration}
                          </p>
                        </div>
                        <Badge variant="neutral">{item.dispenseStatus}</Badge>
                      </div>

                      {/* FEFO Batch Dropdown */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] block mb-1">
                            FEFO Batch Selection (Auto-ranked by nearest expiry)
                          </label>
                          <select
                            value={selectedBatchId}
                            onChange={(e) =>
                              setSelectedBatches({ ...selectedBatches, [item.id]: e.target.value })
                            }
                            className="input text-xs font-mono py-1.5"
                          >
                            {options.length === 0 ? (
                              <option value="">No stock available</option>
                            ) : (
                              options.map((b) => (
                                <option key={b.id} value={b.id}>
                                  Batch #{b.batchNumber} (Stock: {b.currentStock} | Exp:{' '}
                                  {new Date(b.expiryDate).toLocaleDateString()})
                                </option>
                              ))
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] block mb-1">
                            Dispense Quantity
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={dispenseQtyMap[item.id] || 1}
                            onChange={(e) =>
                              setDispenseQtyMap({
                                ...dispenseQtyMap,
                                [item.id]: parseInt(e.target.value) || 1,
                              })
                            }
                            className="input text-xs py-1.5"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Confirm Dispense Button */}
              <div className="pt-4 border-t border-[var(--color-border)] flex justify-end">
                <button
                  onClick={handleDispense}
                  disabled={dispensing || queue.length === 0}
                  className="btn btn-primary btn-lg gap-2"
                >
                  <ShieldCheck className="w-5 h-5" />
                  {dispensing ? 'Dispensing...' : 'Confirm & Dispense Medicines'}
                </button>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-sm text-[var(--color-text-tertiary)]">
              Select a prescription from the left queue to dispense.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
