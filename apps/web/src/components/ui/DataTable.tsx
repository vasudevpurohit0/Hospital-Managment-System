import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, Download } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  searchPlaceholder?: string;
  searchableKey?: keyof T | ((item: T) => string);
  actions?: (item: T) => React.ReactNode;
  title?: string;
  subtitle?: string;
  onExportCsv?: () => void;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  searchPlaceholder = 'Filter records...',
  searchableKey,
  actions,
  title,
  subtitle,
  onExportCsv,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const query = search.toLowerCase();
    return data.filter((item) => {
      if (typeof searchableKey === 'function') {
        return searchableKey(item).toLowerCase().includes(query);
      }
      if (searchableKey) {
        return String(item[searchableKey]).toLowerCase().includes(query);
      }
      return JSON.stringify(item).toLowerCase().includes(query);
    });
  }, [data, search, searchableKey]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      const valA = (a as Record<string, unknown>)[sortKey];
      const valB = (b as Record<string, unknown>)[sortKey];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const comp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
      return sortDirection === 'asc' ? comp : -comp;
    });
  }, [filteredData, sortKey, sortDirection]);

  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else {
        setSortKey(null);
        setSortDirection('asc');
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="card overflow-hidden">
      {(title || searchPlaceholder || onExportCsv) && (
        <div className="p-4 sm:p-5 border-b border-[var(--color-border)] flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            {title && (
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">{title}</h3>
            )}
            {subtitle && (
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                className="input input-with-icon py-1.5 text-xs"
              />
            </div>
            {onExportCsv && (
              <button
                onClick={onExportCsv}
                className="btn btn-secondary btn-sm gap-1.5"
                title="Export CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Export</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  className={
                    col.sortable
                      ? 'cursor-pointer select-none hover:bg-[var(--color-surface-hover)]'
                      : ''
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span className="text-[var(--color-text-tertiary)]">
                        {sortKey === col.key ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-primary-500" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-primary-500" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-3.5 h-3.5" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {actions && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (actions ? 1 : 0)}
                  className="text-center py-8 text-sm text-[var(--color-text-tertiary)]"
                >
                  No records matching your search criteria.
                </td>
              </tr>
            ) : (
              paginatedData.map((item) => (
                <tr key={keyExtractor(item)}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render
                        ? col.render(item)
                        : String((item as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                  {actions && <td className="text-right whitespace-nowrap">{actions(item)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 sm:px-5 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
        <div>
          Showing {sortedData.length > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
          {Math.min(page * pageSize, sortedData.length)} of {sortedData.length} entries
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className="btn btn-secondary btn-sm px-2.5 py-1 text-xs"
          >
            Previous
          </button>
          <span className="px-2 font-medium text-[var(--color-text-primary)]">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page === totalPages}
            className="btn btn-secondary btn-sm px-2.5 py-1 text-xs"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
