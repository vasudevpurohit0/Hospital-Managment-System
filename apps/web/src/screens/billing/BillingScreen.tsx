import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchBillingTransactions,
  fetchReceipt,
  BillingTransactionRecord,
  ReceiptRecord,
} from '../../api/billing.api';

interface BillingScreenProps {
  authToken?: string;
  token?: string;
}

export const BillingScreen: React.FC<BillingScreenProps> = ({ authToken, token }) => {
  const activeToken = authToken || token || '';
  const [transactions, setTransactions] = useState<BillingTransactionRecord[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'FREE' | 'COVERED' | 'PAID'>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Receipt Modal State
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBillingTransactions(activeToken);
      setTransactions(data);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load billing transactions');
    } finally {
      setLoading(false);
    }
  }, [activeToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenReceipt = async (txId: string) => {
    setLoadingReceipt(true);
    try {
      const receipt = await fetchReceipt(txId, activeToken);
      setSelectedReceipt(receipt);
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to generate receipt');
    } finally {
      setLoadingReceipt(false);
    }
  };

  const filteredTransactions = transactions.filter((t) => {
    if (filter === 'ALL') return true;
    return t.outcome === filter;
  });

  const totalPaidRevenue = transactions
    .filter((t) => t.outcome === 'PAID')
    .reduce((sum, t) => sum + (t.amount ? Number(t.amount) : 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🧾</span> Billing & Benefit Ledger
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Same-transaction billing ledger generated at dispense time • Paid medicine receipts &
            benefit outcomes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl text-right">
            <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
              Total Paid Revenue
            </div>
            <div className="text-xl font-black text-emerald-700">
              ₹{totalPaidRevenue.toFixed(2)}
            </div>
          </div>
          <button
            onClick={loadData}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Outcome Filter Buttons */}
      <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'ALL'
                ? 'bg-esic-primary text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Ledger Records ({transactions.length})
          </button>
          <button
            onClick={() => setFilter('FREE')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'FREE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            💚 Free (Permanent Emp) ({transactions.filter((t) => t.outcome === 'FREE').length})
          </button>
          <button
            onClick={() => setFilter('COVERED')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'COVERED'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            🛡️ Covered (Superannuated) ({transactions.filter((t) => t.outcome === 'COVERED').length}
            )
          </button>
          <button
            onClick={() => setFilter('PAID')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'PAID'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            💳 Paid (Contractual Purchases) (
            {transactions.filter((t) => t.outcome === 'PAID').length})
          </button>
        </div>
      </div>

      {/* Ledger Table */}
      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-500">
          Loading billing transactions...
        </div>
      ) : error ? (
        <div className="text-center py-8 bg-red-50 text-red-600 rounded-xl border border-red-200">
          ❌ {error}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b">
                <tr>
                  <th className="p-3">Tx ID</th>
                  <th className="p-3">Patient & Emp Type</th>
                  <th className="p-3">Dispensed Medicine</th>
                  <th className="p-3">Benefit Outcome</th>
                  <th className="p-3">Amount Charged</th>
                  <th className="p-3">Receipt Reference</th>
                  <th className="p-3 text-right">Receipt Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTransactions.map((tx) => {
                  const emp = tx.prescriptionItem?.prescription?.visit?.employee;
                  const patientName = emp?.patientProfile?.fullName || 'Beneficiary';
                  const empType = emp?.employmentType?.name || 'Standard';

                  return (
                    <tr key={tx.id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-mono font-bold text-gray-800">{tx.id}</td>
                      <td className="p-3">
                        <div className="font-bold text-gray-900">{patientName}</div>
                        <div className="text-gray-500 text-[11px]">{empType}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-gray-800">
                          {tx.prescriptionItem?.medicineName || 'Medicine'}
                        </div>
                        <div className="text-gray-400 text-[11px]">
                          {tx.prescriptionItem?.dose} • {tx.prescriptionItem?.frequency} •{' '}
                          {tx.prescriptionItem?.duration}
                        </div>
                      </td>
                      <td className="p-3 font-bold">
                        {tx.outcome === 'FREE' && (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg">
                            💚 Free
                          </span>
                        )}
                        {tx.outcome === 'COVERED' && (
                          <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg">
                            🛡️ Covered
                          </span>
                        )}
                        {tx.outcome === 'PAID' && (
                          <span className="px-2.5 py-1 bg-purple-100 text-purple-800 rounded-lg">
                            💳 Paid
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-bold text-sm text-gray-900">
                        {tx.amount ? `₹${Number(tx.amount).toFixed(2)}` : '₹0.00'}
                      </td>
                      <td className="p-3 font-mono text-gray-600">
                        {tx.receiptReference || (
                          <span className="text-gray-400">N/A (Free/Covered)</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {tx.outcome === 'PAID' ? (
                          <button
                            onClick={() => handleOpenReceipt(tx.id)}
                            disabled={loadingReceipt}
                            className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-semibold transition-all shadow-sm flex items-center gap-1.5 ml-auto"
                          >
                            📄 Print / View Receipt
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenReceipt(tx.id)}
                            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded font-medium text-xs ml-auto"
                          >
                            View Summary
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

      {/* Printable Receipt Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6">
            {/* Header & Logo */}
            <div className="border-b pb-4 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-esic-primary rounded-lg flex items-center justify-center text-white font-black text-sm">
                    ESIC
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-gray-900">
                      {selectedReceipt.issuingHospital}
                    </h2>
                    <p className="text-xs text-gray-500">
                      Official Pharmacy Purchase Receipt • Benefit Ledger
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                ✖
              </button>
            </div>

            {/* Receipt Summary Card */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3 font-sans text-xs">
              <div className="flex justify-between border-b border-gray-200 pb-2">
                <div>
                  <span className="text-gray-400 uppercase font-bold text-[10px] block">
                    Receipt Reference
                  </span>
                  <span className="font-mono font-bold text-gray-900 text-sm">
                    {selectedReceipt.receiptReference}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-gray-400 uppercase font-bold text-[10px] block">
                    Issue Date
                  </span>
                  <span className="font-bold text-gray-800">
                    {new Date(selectedReceipt.issueDate).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">
                    Patient Name
                  </span>
                  <span className="font-bold text-gray-900">{selectedReceipt.patientName}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">
                    ESIC Employee ID
                  </span>
                  <span className="font-mono font-bold text-gray-800">
                    {selectedReceipt.employeeId}
                  </span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-3 space-y-1">
                <span className="text-gray-400 block text-[10px] uppercase font-bold mb-1">
                  Purchased Line Item
                </span>
                <div className="flex justify-between font-semibold text-gray-800 bg-white p-2.5 rounded-lg border border-gray-200">
                  <div>
                    <div>{selectedReceipt.medicineName}</div>
                    <div className="text-gray-400 text-[11px]">
                      {selectedReceipt.dose} • {selectedReceipt.frequency} (
                      {selectedReceipt.duration})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-gray-900">
                      ₹{selectedReceipt.amountCharged.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-purple-700 font-bold uppercase">
                      {selectedReceipt.outcome}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                <span className="font-bold text-gray-700 text-sm">Total Amount Paid</span>
                <span className="text-xl font-black text-emerald-700">
                  ₹{selectedReceipt.amountCharged.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Print & Close Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-esic-primary text-white rounded-lg text-sm font-semibold hover:bg-esic-primary-dark shadow-sm flex items-center gap-1.5"
              >
                🖨️ Print Receipt (PDF)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
