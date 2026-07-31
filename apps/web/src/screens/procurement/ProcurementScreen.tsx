import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchRequisitions,
  createRequisition,
  approveRequisition,
  fetchPurchaseOrders,
  createPurchaseOrder,
  createGRN,
  createStoreTransfer,
  RequisitionRecord,
  PurchaseOrderRecord,
} from '../../api/procurement.api';

interface ProcurementScreenProps {
  authToken?: string;
  token?: string;
}

export const ProcurementScreen: React.FC<ProcurementScreenProps> = ({ authToken, token }) => {
  const activeToken = authToken || token || '';
  const [requisitions, setRequisitions] = useState<RequisitionRecord[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'REQUISITIONS' | 'POS' | 'GRN' | 'TRANSFER'>(
    'REQUISITIONS',
  );

  // Modals
  const [showReqModal, setShowReqModal] = useState(false);
  const [showPOModal, setShowPOModal] = useState(false);
  const [showGRNModal, setShowGRNModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Form states
  const [reqMedicineId, setReqMedicineId] = useState('');
  const [reqQuantity, setReqQuantity] = useState('500');

  const [poReqId, setPoReqId] = useState('');
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poUnitPrice, setPoUnitPrice] = useState('10.00');

  const [grnPOId, setGrnPOId] = useState('');
  const [grnBatchNum, setGrnBatchNum] = useState('');
  const [grnManufacturer, setGrnManufacturer] = useState('');
  const [grnQty, setGrnQty] = useState('500');
  const [grnMfgDate, setGrnMfgDate] = useState('2026-01-01');
  const [grnExpDate, setGrnExpDate] = useState('2028-06-30');
  const [grnPurchasePrice, setGrnPurchasePrice] = useState('10.00');
  const [grnIssuePrice, setGrnIssuePrice] = useState('15.00');

  const [transferBatchId, setTransferBatchId] = useState('');
  const [transferQty, setTransferQty] = useState('100');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reqs = await fetchRequisitions(activeToken);
      setRequisitions(reqs);
      const pos = await fetchPurchaseOrders(activeToken);
      setPurchaseOrders(pos);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load procurement data');
    } finally {
      setLoading(false);
    }
  }, [activeToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateRequisition = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRequisition(
        {
          items: [{ medicineId: reqMedicineId, quantity: parseInt(reqQuantity, 10) }],
        },
        activeToken,
      );
      setShowReqModal(false);
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error raising requisition');
    }
  };

  const handleApproveRequisition = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await approveRequisition(id, { decision, notes: 'Approved by Store Manager' }, activeToken);
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error approving requisition');
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poReqId || !poSupplierId.trim()) return;
    try {
      const req = requisitions.find((r) => r.id === poReqId);
      const items = (req?.items || []).map((i) => ({
        medicineId: i.medicineId,
        quantity: i.quantity,
        unitPrice: parseFloat(poUnitPrice),
      }));

      await createPurchaseOrder(
        {
          requisitionId: poReqId,
          supplierId: poSupplierId.trim(),
          items,
        },
        activeToken,
      );
      setShowPOModal(false);
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error issuing PO');
    }
  };

  const handleCreateGRN = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grnPOId) return;
    try {
      const po = purchaseOrders.find((p) => p.id === grnPOId);
      const medId = po?.items[0]?.medicineId;
      if (!medId) {
        alert('Selected purchase order has no line items to receive.');
        return;
      }

      await createGRN(
        {
          purchaseOrderId: grnPOId,
          items: [
            {
              medicineId: medId,
              batchNumber: grnBatchNum,
              manufacturer: grnManufacturer,
              quantity: parseInt(grnQty, 10),
              manufacturingDate: grnMfgDate,
              expiryDate: grnExpDate,
              purchasePrice: parseFloat(grnPurchasePrice),
              issuePrice: parseFloat(grnIssuePrice),
              qualityCheckPass: true,
            },
          ],
        },
        activeToken,
      );
      setShowGRNModal(false);
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error recording Goods Receipt Note');
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createStoreTransfer(
        {
          medicineBatchId: transferBatchId,
          fromLocation: 'CENTRAL_STORE',
          toLocation: 'PHARMACY',
          quantity: parseInt(transferQty, 10),
        },
        activeToken,
      );
      setShowTransferModal(false);
      alert('Stock transferred successfully from Central Store to Hospital Pharmacy!');
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error executing store transfer');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>🚚</span> Supply Chain & Procurement Console
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Store Manager & Procurement Officer Workstation • Approval Gating (FR-SCM-03), GRN &
            Stock Transfer
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowReqModal(true)}
            className="px-3.5 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
          >
            + Raise Requisition
          </button>
          <button
            onClick={() => setShowTransferModal(true)}
            className="px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
          >
            🔄 Transfer to Pharmacy
          </button>
          <button
            onClick={loadData}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('REQUISITIONS')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'REQUISITIONS'
                ? 'bg-esic-primary text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            📋 Purchase Requisitions & Approvals ({requisitions.length})
          </button>
          <button
            onClick={() => setActiveSubTab('POS')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'POS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            📜 Purchase Orders ({purchaseOrders.length})
          </button>
          <button
            onClick={() => setActiveSubTab('GRN')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'GRN'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            📥 Goods Receipt Notes (GRN)
          </button>
          <button
            onClick={() => setActiveSubTab('TRANSFER')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'TRANSFER'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            🔀 Central Store Transfers
          </button>
        </div>
      </div>

      {/* Main Content Areas */}
      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-500">
          Loading procurement data...
        </div>
      ) : error ? (
        <div className="text-center py-8 bg-red-50 text-red-600 rounded-xl border border-red-200">
          ❌ {error}
        </div>
      ) : activeSubTab === 'REQUISITIONS' ? (
        /* Requisitions Tab */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 text-sm">Purchase Requisitions</h3>
            <span className="text-xs text-gray-500">
              Approved requisitions unlock Purchase Order creation (FR-SCM-03)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b">
                <tr>
                  <th className="p-3">Req ID</th>
                  <th className="p-3">Items & Quantities</th>
                  <th className="p-3">Trigger Source</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Approval Log</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requisitions.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50/50">
                    <td className="p-3 font-mono font-bold text-gray-800">{req.id}</td>
                    <td className="p-3">
                      {(req.items || []).map((i) => (
                        <div key={i.id || i.medicineId}>
                          <strong>{i.medicine?.genericName || i.medicineId}</strong>: {i.quantity}{' '}
                          units
                        </div>
                      ))}
                    </td>
                    <td className="p-3">
                      {req.triggeredByAlert ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">
                          ⚠️ Low-Stock Alert
                        </span>
                      ) : (
                        <span className="text-gray-500">Manual Request</span>
                      )}
                    </td>
                    <td className="p-3 font-bold">
                      {req.status === 'APPROVED' && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                          ✅ Approved
                        </span>
                      )}
                      {req.status === 'REJECTED' && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded">
                          ❌ Rejected
                        </span>
                      )}
                      {req.status === 'PENDING' && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
                          ⏳ Pending Approval
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-gray-500">
                      {(req.approvals || []).length > 0 ? (
                        req.approvals.map((a) => (
                          <div key={a.id}>
                            Decision: <strong>{a.decision}</strong> (
                            {new Date(a.decidedAt).toLocaleDateString()})
                          </div>
                        ))
                      ) : (
                        <span className="text-gray-400">Awaiting review</span>
                      )}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      {req.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleApproveRequisition(req.id, 'APPROVED')}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleApproveRequisition(req.id, 'REJECTED')}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {req.status === 'APPROVED' && (
                        <button
                          onClick={() => {
                            setPoReqId(req.id);
                            setShowPOModal(true);
                          }}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
                        >
                          + Issue PO
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeSubTab === 'POS' ? (
        /* Purchase Orders Tab */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 text-sm">
              Purchase Orders (Issued to Suppliers)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b">
                <tr>
                  <th className="p-3">PO ID</th>
                  <th className="p-3">Requisition Ref</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Ordered Items</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-gray-50/50">
                    <td className="p-3 font-mono font-bold text-gray-800">{po.id}</td>
                    <td className="p-3 font-mono text-gray-600">{po.requisitionId}</td>
                    <td className="p-3 font-semibold text-gray-700">
                      {po.supplier?.name || 'Supplier'}
                    </td>
                    <td className="p-3">
                      {(po.items || []).map((i) => (
                        <div key={i.id || i.medicineId}>
                          <strong>{i.medicine?.genericName || i.medicineId}</strong>: {i.quantity}{' '}
                          units @ ₹{i.unitPrice}
                        </div>
                      ))}
                    </td>
                    <td className="p-3 font-bold">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                        {po.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {po.status !== 'RECEIVED' && po.status !== 'CLOSED' && (
                        <button
                          onClick={() => {
                            setGrnPOId(po.id);
                            setShowGRNModal(true);
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold"
                        >
                          📥 Record GRN Delivery
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeSubTab === 'GRN' ? (
        /* GRN Tab */
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="font-bold text-gray-800 text-sm border-b pb-2">
            Goods Receipt Notes (GRN) & Central Store Stock Receiver
          </h3>
          <p className="text-xs text-gray-500">
            Confirming a delivery creates new <strong>MedicineBatch</strong> rows and adds stock
            directly to <strong>Central Store</strong>.
          </p>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (purchaseOrders.length > 0) setGrnPOId(purchaseOrders[0].id);
                setShowGRNModal(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
            >
              + Record Goods Receipt Note (GRN)
            </button>
          </div>
        </div>
      ) : (
        /* Stock Transfer Tab */
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 space-y-4">
          <h3 className="font-bold text-gray-800 text-sm border-b pb-2">
            Stock Transfer (Central Store ➔ Hospital Pharmacy)
          </h3>
          <p className="text-xs text-gray-500">
            Transfers atomically decrease Central Store PharmacyStock and increase Pharmacy
            PharmacyStock for the specified batch.
          </p>
          <div className="flex justify-end">
            <button
              onClick={() => setShowTransferModal(true)}
              className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
            >
              🔀 Execute Store Transfer
            </button>
          </div>
        </div>
      )}

      {/* Raise Requisition Modal */}
      {showReqModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Raise Purchase Requisition</h2>
              <button
                onClick={() => setShowReqModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateRequisition} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Medicine *</label>
                <input
                  type="text"
                  required
                  placeholder="Medicine ID e.g. med-paracetamol"
                  value={reqMedicineId}
                  onChange={(e) => setReqMedicineId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Quantity *</label>
                <input
                  type="number"
                  required
                  value={reqQuantity}
                  onChange={(e) => setReqQuantity(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowReqModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-esic-primary text-white rounded-lg text-sm font-semibold"
                >
                  Submit Requisition
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create PO Modal */}
      {showPOModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Issue Purchase Order (PO)</h2>
              <button
                onClick={() => setShowPOModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreatePO} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Requisition ID *
                </label>
                <input
                  type="text"
                  required
                  value={poReqId}
                  onChange={(e) => setPoReqId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                />
                <span className="text-[11px] text-gray-400">
                  Must be an APPROVED requisition (FR-SCM-03)
                </span>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Supplier ID *</label>
                <input
                  type="text"
                  required
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Negotiated Unit Price (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={poUnitPrice}
                  onChange={(e) => setPoUnitPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowPOModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
                >
                  Issue Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record GRN Modal */}
      {showGRNModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Record Goods Receipt Note (GRN)</h2>
              <button
                onClick={() => setShowGRNModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateGRN} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Purchase Order ID *
                </label>
                <input
                  type="text"
                  required
                  value={grnPOId}
                  onChange={(e) => setGrnPOId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Batch Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={grnBatchNum}
                    onChange={(e) => setGrnBatchNum(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Manufacturer *
                  </label>
                  <input
                    type="text"
                    required
                    value={grnManufacturer}
                    onChange={(e) => setGrnManufacturer(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Quantity *</label>
                  <input
                    type="number"
                    required
                    value={grnQty}
                    onChange={(e) => setGrnQty(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Purchase Price *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={grnPurchasePrice}
                    onChange={(e) => setGrnPurchasePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Issue Price *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={grnIssuePrice}
                    onChange={(e) => setGrnIssuePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Mfg Date *</label>
                  <input
                    type="date"
                    required
                    value={grnMfgDate}
                    onChange={(e) => setGrnMfgDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={grnExpDate}
                    onChange={(e) => setGrnExpDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowGRNModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold"
                >
                  Confirm GRN & Add Central Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Store Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Execute Store Transfer</h2>
              <button
                onClick={() => setShowTransferModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateTransfer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Medicine Batch ID *
                </label>
                <input
                  type="text"
                  required
                  value={transferBatchId}
                  onChange={(e) => setTransferBatchId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900">
                Transferring from: <strong>CENTRAL_STORE</strong> ➔ To: <strong>PHARMACY</strong>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Quantity to Transfer *
                </label>
                <input
                  type="number"
                  required
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-semibold"
                >
                  Execute Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
