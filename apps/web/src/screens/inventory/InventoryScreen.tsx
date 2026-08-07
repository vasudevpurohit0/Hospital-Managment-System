import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchMedicines,
  createMedicine,
  createBatch,
  fetchLowStockAlerts,
  MedicineRecord,
} from '../../api/inventory.api';

interface InventoryScreenProps {
  authToken?: string;
  token?: string;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ authToken, token }) => {
  const activeToken = authToken || token || '';
  const [medicines, setMedicines] = useState<MedicineRecord[]>([]);
  const [lowStockBatches, setLowStockBatches] = useState<
    (MedicineRecord['batches'][number] & { medicine?: MedicineRecord })[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Modals
  const [showAddMedModal, setShowAddMedModal] = useState(false);
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [selectedMedIdForBatch, setSelectedMedIdForBatch] = useState<string>('');

  // Add Med Form
  const [medGenericName, setMedGenericName] = useState('');
  const [medBrandName, setMedBrandName] = useState('');
  const [medCategory, setMedCategory] = useState('Analgesics & Antipyretics');
  const [medStrength, setMedStrength] = useState('500mg');
  const [medDosageForm, setMedDosageForm] = useState('Tablet');

  // Add Batch Form
  const [batchNum, setBatchNum] = useState('');
  const [batchManufacturer, setBatchManufacturer] = useState('');
  const [batchMfgDate, setBatchMfgDate] = useState('2026-01-01');
  const [batchExpDate, setBatchExpDate] = useState('2027-12-31');
  const [batchPurchasePrice, setBatchPurchasePrice] = useState('10.00');
  const [batchIssuePrice, setBatchIssuePrice] = useState('15.00');
  const [batchCurrentStock, setBatchCurrentStock] = useState('500');
  const [batchMinStock, setBatchMinStock] = useState('50');
  const [batchReorderLevel, setBatchReorderLevel] = useState('100');
  const [batchStorageLoc, setBatchStorageLoc] = useState('Rack A-01');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const medData = await fetchMedicines(activeToken);
      setMedicines(medData);
      const lowData = await fetchLowStockAlerts(activeToken);
      setLowStockBatches(
        lowData as (MedicineRecord['batches'][number] & { medicine?: MedicineRecord })[],
      );
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load inventory data');
    } finally {
      setLoading(false);
    }
  }, [activeToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMedicine(
        {
          genericName: medGenericName,
          brandName: medBrandName || undefined,
          category: medCategory,
          strength: medStrength,
          dosageForm: medDosageForm,
        },
        activeToken,
      );
      setShowAddMedModal(false);
      setMedGenericName('');
      setMedBrandName('');
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error creating medicine');
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedIdForBatch) return;
    try {
      await createBatch(
        {
          medicineId: selectedMedIdForBatch,
          batchNumber: batchNum,
          manufacturer: batchManufacturer,
          manufacturingDate: batchMfgDate,
          expiryDate: batchExpDate,
          purchasePrice: parseFloat(batchPurchasePrice),
          issuePrice: parseFloat(batchIssuePrice),
          currentStock: parseInt(batchCurrentStock, 10),
          minimumStockLevel: parseInt(batchMinStock, 10),
          reorderLevel: parseInt(batchReorderLevel, 10),
          storageLocation: batchStorageLoc,
        },
        activeToken,
      );
      setShowAddBatchModal(false);
      setBatchNum('');
      setBatchManufacturer('');
      loadData();
    } catch (err: unknown) {
      alert((err as Error).message || 'Error creating batch');
    }
  };

  const filteredMedicines = medicines.filter((m) => {
    const matchesSearch =
      m.genericName.toLowerCase().includes(search.toLowerCase()) ||
      (m.brandName && m.brandName.toLowerCase().includes(search.toLowerCase())) ||
      m.category.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedCategory === 'ALL' || m.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const categories = Array.from(new Set(medicines.map((m) => m.category)));

  const renderStockBadge = (batch: any) => {
    const isBelowMin = batch.currentStock < (batch.minimumStockLevel ?? 50);

    if (isBelowMin) {
      if (batch.hasActiveRequisition) {
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            🟢 Requisition Generated
          </span>
        );
      } else {
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 font-orange-badge">
            🟠 Low Stock
          </span>
        );
      }
    }

    switch (batch.stockStatus) {
      case 'IN_STOCK':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            🟢 In Stock
          </span>
        );
      case 'EARLY_WARNING':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            ⚠️ Early Warning (Low)
          </span>
        );
      case 'CRITICAL_ALERT':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
            🚨 Critical Alert (Very Low)
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-300">
            ❌ Expired
          </span>
        );
      case 'QUARANTINED':
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-300">
            ⛔ Quarantined
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
            {batch.stockStatus}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>📦</span> Central Inventory & Medicine Master
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Store Manager Console • FEFO Expiry Tracking & Reorder Alert Engine
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddMedModal(true)}
            className="px-4 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
          >
            + Add Medicine Master
          </button>
          <button
            onClick={loadData}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Low Stock Alerts Banner */}
      {lowStockBatches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-amber-900">
              Low Stock Reorder Alert ({lowStockBatches.length} Batches Below Reorder Level)
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {lowStockBatches.map((b, idx) => (
                <span
                  key={b.id || idx}
                  className="px-2.5 py-1 bg-amber-100 border border-amber-300 rounded text-xs text-amber-900 font-medium"
                >
                  <strong>{b.medicine?.genericName || b.batchNumber}</strong>: {b.currentStock}{' '}
                  units left (Reorder level: {b.reorderLevel})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search & Category Filter Toolbar */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="w-full md:w-80">
          <input
            type="text"
            placeholder="Search generic, brand, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3.5 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Category:
          </span>
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedCategory === 'ALL'
                ? 'bg-esic-primary text-white font-semibold'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-esic-primary text-white font-semibold'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Medicine Catalog List */}
      {loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-500">
          Loading inventory master catalog...
        </div>
      ) : error ? (
        <div className="text-center py-8 bg-red-50 text-red-600 rounded-xl border border-red-200">
          ❌ {error}
        </div>
      ) : filteredMedicines.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-400">
          No medicines match your search filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMedicines.map((med) => {
            const totalStock = (med.batches || []).reduce((acc, b) => acc + b.currentStock, 0);

            return (
              <div
                key={med.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:border-gray-300 transition-all"
              >
                <div className="p-4 bg-gray-50/80 border-b border-gray-200 flex flex-col md:flex-row justify-between md:items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900">{med.genericName}</h3>
                      {med.brandName && (
                        <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                          {med.brandName}
                        </span>
                      )}
                      <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded">
                        {med.category}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Strength: <strong>{med.strength}</strong> • Dosage Form:{' '}
                      <strong>{med.dosageForm}</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-gray-500 font-medium">Total Available Stock</div>
                      <div className="text-base font-bold text-gray-900">{totalStock} units</div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedMedIdForBatch(med.id);
                        setShowAddBatchModal(true);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                    >
                      + Add Batch
                    </button>
                  </div>
                </div>

                {/* Batches Table */}
                <div className="p-4 overflow-x-auto">
                  {!med.batches || med.batches.length === 0 ? (
                    <div className="text-center py-4 text-xs text-gray-400">
                      No active batches recorded for this medicine.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-400 uppercase tracking-wider font-bold">
                          <th className="pb-2">Batch #</th>
                          <th className="pb-2">Manufacturer</th>
                          <th className="pb-2">Expiry Date</th>
                          <th className="pb-2">Stock Level</th>
                          <th className="pb-2">Prices (Purchase / Issue)</th>
                          <th className="pb-2">Location</th>
                          <th className="pb-2">Stock Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {med.batches.map((batch) => (
                          <tr key={batch.id} className="hover:bg-gray-50/50">
                            <td className="py-2.5 font-bold text-gray-800">{batch.batchNumber}</td>
                            <td className="py-2.5 text-gray-600">{batch.manufacturer}</td>
                            <td className="py-2.5 text-gray-600 font-medium">
                              {new Date(batch.expiryDate).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="py-2.5 font-bold text-gray-900">
                              {batch.currentStock}{' '}
                              <span className="text-gray-400 text-[10px]">units</span>
                            </td>
                            <td className="py-2.5 text-gray-600">
                              ₹{batch.purchasePrice} /{' '}
                              <strong className="text-gray-900">₹{batch.issuePrice}</strong>
                            </td>
                            <td className="py-2.5 text-gray-500">
                              {batch.storageLocation || 'Main Store'}
                            </td>
                            <td className="py-2.5">{renderStockBadge(batch)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Medicine Modal */}
      {showAddMedModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Register New Medicine Master</h2>
              <button
                onClick={() => setShowAddMedModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateMedicine} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Generic Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Paracetamol"
                  value={medGenericName}
                  onChange={(e) => setMedGenericName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Brand Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Crocin"
                  value={medBrandName}
                  onChange={(e) => setMedBrandName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Category *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Analgesics & Antipyretics"
                  value={medCategory}
                  onChange={(e) => setMedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Strength *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 500mg"
                    value={medStrength}
                    onChange={(e) => setMedStrength(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Dosage Form *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tablet"
                    value={medDosageForm}
                    onChange={(e) => setMedDosageForm(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddMedModal(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
                >
                  Save Medicine Master
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Batch Modal */}
      {showAddBatchModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-gray-900">Add New Stock Batch</h2>
              <button
                onClick={() => setShowAddBatchModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✖
              </button>
            </div>
            <form onSubmit={handleCreateBatch} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Batch Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BATCH-2026-X1"
                    value={batchNum}
                    onChange={(e) => setBatchNum(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Manufacturer *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Cipla India"
                    value={batchManufacturer}
                    onChange={(e) => setBatchManufacturer(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Manufacturing Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchMfgDate}
                    onChange={(e) => setBatchMfgDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchExpDate}
                    onChange={(e) => setBatchExpDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Purchase Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={batchPurchasePrice}
                    onChange={(e) => setBatchPurchasePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Issue Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={batchIssuePrice}
                    onChange={(e) => setBatchIssuePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Initial Stock *
                  </label>
                  <input
                    type="number"
                    required
                    value={batchCurrentStock}
                    onChange={(e) => setBatchCurrentStock(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Min Stock Level
                  </label>
                  <input
                    type="number"
                    value={batchMinStock}
                    onChange={(e) => setBatchMinStock(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    Reorder Level
                  </label>
                  <input
                    type="number"
                    value={batchReorderLevel}
                    onChange={(e) => setBatchReorderLevel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Storage Rack</label>
                  <input
                    type="text"
                    placeholder="Rack A-01"
                    value={batchStorageLoc}
                    onChange={(e) => setBatchStorageLoc(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-esic-primary focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddBatchModal(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-all shadow-sm"
                >
                  Save Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
