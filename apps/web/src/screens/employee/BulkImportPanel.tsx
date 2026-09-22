import React, { useRef, useState } from 'react';
import { Upload, Download } from 'lucide-react';
import {
  downloadEmployeeTemplate,
  validateEmployeeImport,
  confirmEmployeeImport,
  downloadEmployeeErrorReport,
  EmployeeImportValidation,
  EmployeeImportResult,
} from '../../api/employee.api';

/**
 * Bulk Employee Import panel. Reuses the existing employee-creation service on
 * the backend; here it only drives the workflow: download template -> upload
 * CSV -> preview/validate -> import valid rows -> summary + error report.
 * Styled consistently with the surrounding Employee Directory (card/btn/table).
 */
const STATUS_STYLES: Record<string, string> = {
  VALID: 'bg-success-100 text-success-700',
  INVALID: 'bg-danger-100 text-danger-700',
  DUPLICATE_FILE: 'bg-warning-100 text-warning-700',
  DUPLICATE_EXISTING: 'bg-warning-100 text-warning-700',
};

interface Props {
  authToken: string;
  onImported: () => void;
}

export const BulkImportPanel: React.FC<Props> = ({ authToken, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<EmployeeImportValidation | null>(null);
  const [result, setResult] = useState<EmployeeImportResult | null>(null);

  const reset = () => {
    setValidation(null);
    setResult(null);
    setError(null);
  };

  const handleTemplate = async () => {
    setError(null);
    try {
      await downloadEmployeeTemplate(authToken);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      setValidation(await validateEmployeeImport(file, authToken));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleImport = async () => {
    if (!validation) return;
    const validRows = validation.rows.filter((r) => r.status === 'VALID').map((r) => r.original);
    if (validRows.length === 0) {
      setError('There are no valid rows to import. Fix the errors below and re-upload.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await confirmEmployeeImport(validRows, authToken);
      setResult(res);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleErrorReport = async () => {
    if (!validation) return;
    const bad = validation.rows
      .filter((r) => r.status !== 'VALID')
      .map((r) => ({ rowNum: r.rowNum, employeeId: r.employeeId, error: r.error || '', original: r.original }));
    if (bad.length === 0) return;
    try {
      await downloadEmployeeErrorReport(bad, authToken);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const validCount = validation?.rows.filter((r) => r.status === 'VALID').length ?? 0;
  const badCount = validation ? validation.rows.length - validCount : 0;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="w-5 h-5 text-primary-500" />
        <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Bulk Import Employees (CSV)</h3>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Step 1: download the template. Step 2: fill it in (delete the example rows). Step 3: upload to preview and
        validate. Step 4: import the valid rows. Hospital UID is generated automatically, so it is not part of the CSV.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn-secondary btn-sm gap-1.5" onClick={handleTemplate}>
          <Download className="w-4 h-4" /> Download CSV Template
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm gap-1.5"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="w-4 h-4" /> {fileName ? `Re-upload (${fileName})` : 'Upload CSV'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        {busy && <span className="text-xs text-[var(--color-text-secondary)]">Working...</span>}
      </div>

      {error && <div className="alert alert-danger text-xs">{error}</div>}

      {validation && !result && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className="font-semibold">Total: {validation.totalRows}</span>
            <span className="text-success-700 font-semibold">Valid: {validation.validRows}</span>
            <span className="text-danger-700 font-semibold">Invalid: {validation.invalidRows}</span>
            <span className="text-warning-700 font-semibold">Duplicates: {validation.duplicateRows}</span>
          </div>

          <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg max-h-80 overflow-y-auto">
            <table className="w-max min-w-full text-xs">
              <thead className="bg-[var(--color-surface-2)] sticky top-0">
                <tr>
                  <th className="text-left p-2">Row</th>
                  <th className="text-left p-2">Employee ID</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {validation.rows.map((r) => (
                  <tr key={r.rowNum} className="border-t border-[var(--color-border)]">
                    <td className="p-2">{r.rowNum}</td>
                    <td className="p-2 font-mono">{r.employeeId || '-'}</td>
                    <td className="p-2">{r.original.name || '-'}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLES[r.status] || ''}`}>
                        {r.status === 'VALID' ? 'VALID' : 'ERROR'}
                      </span>
                    </td>
                    <td className="p-2 text-danger-700">{r.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleImport}
              disabled={busy || validCount === 0}
            >
              Import {validCount} Valid {validCount === 1 ? 'Employee' : 'Employees'}
            </button>
            {badCount > 0 && (
              <button type="button" className="btn btn-secondary btn-sm gap-1.5" onClick={handleErrorReport}>
                <Download className="w-4 h-4" /> Download Error Report ({badCount})
              </button>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="alert alert-success text-xs">Import complete.</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="card p-3">
              <div className="text-[var(--color-text-secondary)]">Total Rows</div>
              <div className="text-lg font-bold">{result.totalRows}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--color-text-secondary)]">Valid Rows</div>
              <div className="text-lg font-bold">{result.validRows}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--color-text-secondary)]">Imported</div>
              <div className="text-lg font-bold text-success-700">{result.importedSuccessfully}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--color-text-secondary)]">Failed</div>
              <div className="text-lg font-bold text-danger-700">{result.failedRows}</div>
            </div>
          </div>
          {result.failures.length > 0 && (
            <div className="text-xs text-danger-700">
              {result.failures.map((f) => (
                <div key={f.rowNum}>
                  Row {f.rowNum} - {f.employeeId}: {f.error}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              reset();
              setFileName(null);
            }}
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
};
