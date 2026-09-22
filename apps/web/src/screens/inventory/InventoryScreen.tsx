import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchMedicines,
  createMedicine,
  createBatch,
  fetchLowStockAlerts,
  MedicineRecord,
  downloadMedicineTemplate,
  validateMedicineImport,
  confirmMedicineImport,
  downloadImportErrorReport,
  MedicineImportValidationResult,
  MedicineImportConfirmResult,
} from '../../api/inventory.api';
import { formatDateDDMonYYYY } from '../../utils/date';

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

  // Import Medicines Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<'UPLOAD' | 'PREVIEW' | 'RESULT'>('UPLOAD');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<MedicineImportValidationResult | null>(null);
  const [importResult, setImportResult] = useState<MedicineImportConfirmResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<'ALL' | 'VALID' | 'DUPLICATE' | 'INVALID'>('ALL');
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [downloadingErrorReport, setDownloadingErrorReport] = useState(false);

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

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      await downloadMedicineTemplate(activeToken);
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to download template');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setImportError(null);
    }
  };

  const handleValidateFile = async () => {
    if (!selectedFile) {
      setImportError('Please select an Excel or CSV file to import.');
      return;
    }
    setImportLoading(true);
    setImportError(null);
    try {
      const result = await validateMedicineImport(selectedFile, activeToken);
      setValidationResult(result);
      setImportStep('PREVIEW');
    } catch (err: unknown) {
      setImportError((err as Error).message || 'Validation failed');
    } finally {
      setImportLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!validationResult || validationResult.validItems.length === 0) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const res = await confirmMedicineImport(validationResult.validItems, activeToken);
      setImportResult(res);
      setImportStep('RESULT');
      loadData();
    } catch (err: unknown) {
      setImportError((err as Error).message || 'Failed to confirm import');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownloadErrorReport = async () => {
    if (!validationResult?.rejectedItems || validationResult.rejectedItems.length === 0) return;
    setDownloadingErrorReport(true);
    try {
      await downloadImportErrorReport(validationResult.rejectedItems, activeToken);
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to download error report');
    } finally {
      setDownloadingErrorReport(false);
    }
  };

  const resetImportModal = () => {
    setShowImportModal(false);
    setImportStep('UPLOAD');
    setSelectedFile(null);
    setImportLoading(false);
    setImportError(null);
    setValidationResult(null);
    setImportResult(null);
    setPreviewFilter('ALL');
  };

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

  const filteredItems = (validationResult?.items ?? []).filter((item) => {
    if (previewFilter === 'VALID') return item.status === 'VALID';
    if (previewFilter === 'DUPLICATE')
      return item.status === 'DUPLICATE_FILE' || item.status === 'DUPLICATE_EXISTING';
    if (previewFilter === 'INVALID') return item.status === 'INVALID';
    return true;
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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
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
            onClick={() => {
              resetImportModal();
              setShowImportModal(true);
            }}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-1.5"
          >
            Import Medicines (Excel)
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
                    <table className="w-max min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-400 uppercase tracking-wider font-bold">
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Batch #</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Manufacturer</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Expiry Date</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Stock Level</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Prices (Purchase / Issue)</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Location</th>
                          <th className="pb-2 pr-6 last:pr-0 whitespace-nowrap">Stock Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {med.batches.map((batch) => (
                          <tr key={batch.id} className="hover:bg-gray-50/50">
                            <td className="py-2.5 pr-6 last:pr-0 font-bold text-gray-800">{batch.batchNumber}</td>
                            <td className="py-2.5 pr-6 last:pr-0 text-gray-600">{batch.manufacturer}</td>
                            <td className="py-2.5 pr-6 last:pr-0 text-gray-600 font-medium">
                              {formatDateDDMonYYYY(batch.expiryDate)}
                            </td>
                            <td className="py-2.5 pr-6 last:pr-0 font-bold text-gray-900">
                              {batch.currentStock}{' '}
                              <span className="text-gray-400 text-[10px]">units</span>
                            </td>
                            <td className="py-2.5 pr-6 last:pr-0 text-gray-600">
                              ₹{batch.purchasePrice} /{' '}
                              <strong className="text-gray-900">₹{batch.issuePrice}</strong>
                            </td>
                            <td className="py-2.5 pr-6 last:pr-0 text-gray-500">
                              {batch.storageLocation || 'Main Store'}
                            </td>
                            <td className="py-2.5 pr-6 last:pr-0">{renderStockBadge(batch)}</td>
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

      {/* Import Medicines Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b pb-3 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Import Medicines (Excel)</h2>
                <p className="text-xs text-gray-500">Bulk register medicines into Central Medicine Master</p>
              </div>
              <button
                onClick={resetImportModal}
                className="text-gray-400 hover:text-gray-600 font-bold p-1 text-base"
              >
                ✕
              </button>
            </div>

            {/* Stepper Tabs */}
            <div className="flex border-b border-gray-200 shrink-0 text-xs font-semibold">
              <div
                className={`py-2 px-4 border-b-2 ${
                  importStep === 'UPLOAD'
                    ? 'border-esic-primary text-esic-primary font-bold'
                    : 'border-transparent text-gray-400'
                }`}
              >
                1. Upload & Template
              </div>
              <div
                className={`py-2 px-4 border-b-2 ${
                  importStep === 'PREVIEW'
                    ? 'border-esic-primary text-esic-primary font-bold'
                    : 'border-transparent text-gray-400'
                }`}
              >
                2. Validation Preview
              </div>
              <div
                className={`py-2 px-4 border-b-2 ${
                  importStep === 'RESULT'
                    ? 'border-esic-primary text-esic-primary font-bold'
                    : 'border-transparent text-gray-400'
                }`}
              >
                3. Import Results
              </div>
            </div>

            {/* Step 1: Upload */}
            {importStep === 'UPLOAD' && (
              <div className="space-y-4 overflow-y-auto pr-1">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-2">
                  <div className="font-bold text-sm">Download Template & Instructions</div>
                  <p>
                    Download the official Excel template pre-formatted with the exact columns required for Medicine Master import (Generic Name, Category, Strength, Dosage Form, and optional Brand Name). Fill in your medicine rows and upload the file below.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    disabled={downloadingTemplate}
                    className="mt-1 px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                  >
                    {downloadingTemplate ? 'Downloading…' : 'Download Excel Template'}
                  </button>
                </div>

                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-esic-primary transition-colors bg-gray-50">
                  <input
                    type="file"
                    id="medicine-excel-upload"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <label htmlFor="medicine-excel-upload" className="cursor-pointer block space-y-2">
                    <div className="text-sm font-semibold text-gray-700">
                      {selectedFile ? selectedFile.name : 'Click to select or drop your Excel file (.xlsx, .xls, .csv)'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv)
                    </div>
                    {selectedFile && (
                      <div className="text-xs text-emerald-700 font-semibold mt-1">
                        File selected ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </div>
                    )}
                  </label>
                </div>

                {importError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                    {importError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={resetImportModal}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateFile}
                    disabled={!selectedFile || importLoading}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {importLoading ? 'Validating File…' : 'Validate & Preview'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Validation Preview */}
            {importStep === 'PREVIEW' && validationResult && (
              <div className="space-y-4 overflow-y-auto pr-1 flex-1 flex flex-col min-h-0">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <div className="text-xs text-gray-500 font-medium">Total Rows</div>
                    <div className="text-xl font-bold text-gray-900">{validationResult.totalRows}</div>
                  </div>
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="text-xs text-emerald-700 font-medium">Valid (Will Import)</div>
                    <div className="text-xl font-bold text-emerald-700">{validationResult.validRows}</div>
                  </div>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-xs text-amber-700 font-medium">Duplicates (Skipped)</div>
                    <div className="text-xl font-bold text-amber-700">{validationResult.duplicateRows}</div>
                  </div>
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <div className="text-xs text-red-700 font-medium">Invalid (Errors)</div>
                    <div className="text-xl font-bold text-red-700">{validationResult.invalidRows}</div>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-2 shrink-0 text-xs">
                  {(
                    [
                      { id: 'ALL', label: `All (${validationResult.totalRows})` },
                      { id: 'VALID', label: `Valid (${validationResult.validRows})` },
                      { id: 'DUPLICATE', label: `Duplicates (${validationResult.duplicateRows})` },
                      { id: 'INVALID', label: `Errors (${validationResult.invalidRows})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPreviewFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                        previewFilter === tab.id
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Preview Table */}
                <div className="border border-gray-200 rounded-xl overflow-x-auto flex-1 max-h-[300px]">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold sticky top-0">
                      <tr>
                        <th className="py-2 px-3 text-left">Row</th>
                        <th className="py-2 px-3 text-left">Generic Name</th>
                        <th className="py-2 px-3 text-left">Brand</th>
                        <th className="py-2 px-3 text-left">Category</th>
                        <th className="py-2 px-3 text-left">Strength</th>
                        <th className="py-2 px-3 text-left">Dosage</th>
                        <th className="py-2 px-3 text-left">Status</th>
                        <th className="py-2 px-3 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-gray-500">{item.rowNum}</td>
                          <td className="py-2 px-3 font-bold text-gray-900">{item.genericName || '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{item.brandName || '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{item.category || '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{item.strength || '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{item.dosageForm || '—'}</td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {item.status === 'VALID' && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Valid
                              </span>
                            )}
                            {item.status === 'DUPLICATE_EXISTING' && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                In Master
                              </span>
                            )}
                            {item.status === 'DUPLICATE_FILE' && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                File Duplicate
                              </span>
                            )}
                            {item.status === 'INVALID' && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
                                Error
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-500 text-[11px] max-w-xs truncate" title={item.reason}>
                            {item.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg shrink-0">
                    {importError}
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t shrink-0">
                  <button
                    type="button"
                    onClick={() => setImportStep('UPLOAD')}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
                  >
                    Back / Re-upload
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={validationResult.validRows === 0 || importLoading}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {importLoading
                      ? 'Importing…'
                      : `Confirm & Import (${validationResult.validRows} Medicines)`}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Result */}
            {importStep === 'RESULT' && importResult && (
              <div className="space-y-4 overflow-y-auto pr-1">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-2">
                  <div className="text-base font-bold text-emerald-900">{importResult.message}</div>
                  <p className="text-xs text-emerald-700">
                    The newly imported medicines are now active in the system and ready for prescriptions, dispensing, and inventory tracking.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                    <div className="text-xs text-emerald-700 font-medium">Successfully Imported</div>
                    <div className="text-xl sm:text-2xl font-bold text-emerald-800">{importResult.importedCount}</div>
                  </div>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
                    <div className="text-xs text-amber-700 font-medium">Skipped (Duplicates)</div>
                    <div className="text-xl sm:text-2xl font-bold text-amber-800">{importResult.skippedCount}</div>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-center">
                    <div className="text-xs text-gray-500 font-medium">Total Processed</div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900">
                      {validationResult?.totalRows ?? importResult.importedCount + importResult.skippedCount}
                    </div>
                  </div>
                </div>

                {validationResult?.rejectedItems && validationResult.rejectedItems.length > 0 && (
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-gray-900">Download Error / Skip Report</div>
                      <div className="text-xs text-gray-500">
                        {validationResult.rejectedItems.length} record(s) were skipped or had errors. Download an Excel report for details.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadErrorReport}
                      disabled={downloadingErrorReport}
                      className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                    >
                      {downloadingErrorReport ? 'Downloading…' : 'Download Error Report (Excel)'}
                    </button>
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t">
                  <button
                    type="button"
                    onClick={resetImportModal}
                    className="px-5 py-2 bg-esic-primary hover:bg-esic-primary-dark text-white rounded-lg text-sm font-semibold transition-colors"
                  >
                    Done & View Inventory
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
