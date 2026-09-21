import ExcelJS from 'exceljs';

/** Safety limits (client validation is never trusted) -- mirrors the Employee Directory bulk-import limits (`employee-csv.util.ts`). */
export const MEDICINE_IMPORT_MAX_ROWS = 1000;
export const MEDICINE_IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * F-25/audit finding: this file used to hand-roll its own ZIP/CRC32/OOXML
 * writer and its own regex-based .xlsx/.xls reader from scratch (560 lines)
 * -- a meaningfully riskier piece of code to maintain than an existing,
 * widely-used library. Both directions (write and read) now go through
 * `exceljs`, matching the approach used for the billing Excel export
 * (`apps/api/src/modules/billing/excel-export.util.ts`) so this codebase has
 * one Excel implementation, not two.
 */

async function buildXlsx(sheetName: string, headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  for (const row of rows) {
    sheet.addRow(row);
  }

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generates the official downloadable Excel template with sample rows.
 */
export async function generateMedicineTemplateXlsx(): Promise<Buffer> {
  const headers = ['Generic Name *', 'Brand Name', 'Category *', 'Strength *', 'Dosage Form *'];

  const sampleRows = [
    ['Paracetamol', 'Crocin', 'Analgesics & Antipyretics', '500mg', 'Tablet'],
    ['Amoxicillin', 'Novamox', 'Antibiotics', '250mg', 'Capsule'],
    ['Cetirizine', 'Cetzine', 'Antihistamines', '10mg', 'Tablet'],
    ['Pantoprazole', 'Pan 40', 'Gastrointestinal', '40mg', 'Tablet'],
    ['Salbutamol', 'Asthalin', 'Respiratory', '2mg/5ml', 'Syrup'],
    ['Azithromycin', 'Azee', 'Antibiotics', '500mg', 'Tablet'],
    ['Metformin', 'Glycomet', 'Antidiabetics', '500mg', 'Tablet'],
  ];

  return buildXlsx('Medicine Import Template', headers, sampleRows);
}

export interface ParsedMedicineRow {
  rowNum: number;
  genericName: string;
  brandName: string;
  category: string;
  strength: string;
  dosageForm: string;
}

function parseCsvBuffer(text: string): Array<{ rowNum: number; cells: string[] }> {
  const lines = text.split(/\r?\n/);
  const rows: Array<{ rowNum: number; cells: string[] }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split considering quotes
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if ((char === ',' || char === '\t') && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());

    rows.push({ rowNum: i + 1, cells });
  }

  return rows;
}

async function parseXlsxBuffer(buffer: Buffer): Promise<Array<{ rowNum: number; cells: string[] }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('No worksheet data found in the Excel workbook.');
  }

  const rows: Array<{ rowNum: number; cells: string[] }> = [];
  sheet.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const value = cell.value;
      cells[colNumber - 1] =
        value === null || value === undefined
          ? ''
          : typeof value === 'object' && 'text' in (value as { text?: string })
            ? String((value as { text?: string }).text ?? '')
            : typeof value === 'object' && 'result' in (value as { result?: unknown })
              ? String((value as { result?: unknown }).result ?? '')
              : String(value);
    });
    rows.push({ rowNum: rowNumber, cells });
  });

  return rows;
}

/**
 * Universally parses any Excel (.xlsx, .csv) buffer into row objects.
 */
export async function parseMedicineSpreadsheet(buffer: Buffer): Promise<ParsedMedicineRow[]> {
  if (buffer.byteLength > MEDICINE_IMPORT_MAX_BYTES) {
    throw new Error(
      `Uploaded file is too large (${buffer.byteLength} bytes). Maximum is ${MEDICINE_IMPORT_MAX_BYTES} bytes.`,
    );
  }

  let rawRows: Array<{ rowNum: number; cells: string[] }>;

  // Check magic bytes for ZIP (.xlsx)
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    rawRows = await parseXlsxBuffer(buffer);
  } else {
    rawRows = parseCsvBuffer(buffer.toString('utf8'));
  }

  if (rawRows.length === 0) {
    return [];
  }

  // Find header row
  let headerIndex = -1;
  const colMap = {
    genericName: 0,
    brandName: 1,
    category: 2,
    strength: 3,
    dosageForm: 4,
  };

  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const cells = rawRows[i].cells.map((c) => c.toLowerCase());
    const genericIdx = cells.findIndex((c) => c.includes('generic'));
    const categoryIdx = cells.findIndex((c) => c.includes('category'));

    if (genericIdx !== -1 && categoryIdx !== -1) {
      headerIndex = i;
      colMap.genericName = genericIdx;
      colMap.category = categoryIdx;

      const brandIdx = cells.findIndex((c) => c.includes('brand'));
      if (brandIdx !== -1) colMap.brandName = brandIdx;

      const strengthIdx = cells.findIndex((c) => c.includes('strength'));
      if (strengthIdx !== -1) colMap.strength = strengthIdx;

      const dosageIdx = cells.findIndex((c) => c.includes('dosage') || c.includes('form'));
      if (dosageIdx !== -1) colMap.dosageForm = dosageIdx;
      break;
    }
  }

  const dataRows: ParsedMedicineRow[] = [];
  const startIdx = headerIndex !== -1 ? headerIndex + 1 : 1;

  for (let i = startIdx; i < rawRows.length; i++) {
    const { rowNum, cells } = rawRows[i];
    // Skip completely empty lines
    if (cells.every((c) => !c)) continue;

    dataRows.push({
      rowNum,
      genericName: cells[colMap.genericName] ?? '',
      brandName: cells[colMap.brandName] ?? '',
      category: cells[colMap.category] ?? '',
      strength: cells[colMap.strength] ?? '',
      dosageForm: cells[colMap.dosageForm] ?? '',
    });
  }

  if (dataRows.length > MEDICINE_IMPORT_MAX_ROWS) {
    throw new Error(
      `Too many rows: ${dataRows.length}. The maximum per import is ${MEDICINE_IMPORT_MAX_ROWS}.`,
    );
  }

  return dataRows;
}

export interface RejectedImportRow {
  rowNum: number;
  genericName: string;
  brandName?: string;
  category: string;
  strength: string;
  dosageForm: string;
  status: 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING' | 'INVALID';
  reason: string;
}

/**
 * Builds the downloadable Excel error/skip report.
 */
export async function generateMedicineErrorReportXlsx(rows: RejectedImportRow[]): Promise<Buffer> {
  const headers = [
    'Row #',
    'Generic Name',
    'Brand Name',
    'Category',
    'Strength',
    'Dosage Form',
    'Status',
    'Reason for Failure / Skip',
  ];

  const exportRows = rows.map((r) => [
    r.rowNum,
    r.genericName,
    r.brandName || '',
    r.category,
    r.strength,
    r.dosageForm,
    r.status === 'DUPLICATE_EXISTING'
      ? 'Already in Master (Skipped)'
      : r.status === 'DUPLICATE_FILE'
        ? 'Duplicate in File (Skipped)'
        : 'Validation Error (Failed)',
    r.reason,
  ]);

  return buildXlsx('Medicine Import Errors', headers, exportRows);
}
