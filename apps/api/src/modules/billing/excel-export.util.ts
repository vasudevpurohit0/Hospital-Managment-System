import ExcelJS from 'exceljs';
import { Prisma, ChargeStatus } from '@prisma/client';

/**
 * F-25/audit finding: this used to be a hand-written SpreadsheetML (Excel
 * XML 2003) string builder, a second, independent way of producing Excel
 * output from the ground-up ZIP/OOXML writer in the inventory module
 * (`apps/api/src/modules/inventory/excel/medicine-excel.util.ts`). Both now
 * go through `exceljs`, so this codebase has one Excel implementation.
 */

export interface PatientExpenseDetail {
  patient: {
    id: string;
    name: string;
    employeeId: string;
    uhid: string;
    department: string;
  };
  totalExpense: Prisma.Decimal;
  transactions: Array<{
    date: Date;
    service: string;
    category: string;
    quantity: Prisma.Decimal;
    rate: Prisma.Decimal;
    total: Prisma.Decimal;
    status: ChargeStatus;
  }>;
}

export interface PatientExpenseReportData {
  periodLabel: string;
  from?: Date;
  to?: Date;
  generatedAt: Date;
  grandTotal: Prisma.Decimal;
  totalPatients: number;
  totalTransactions: number;
  patients: PatientExpenseDetail[];
}

function formatDateTime(date?: Date): string {
  if (!date) return '—';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function formatDateOnly(date?: Date): string {
  if (!date) return '—';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

const FILL = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const THIN_BORDER = (color: string): Partial<ExcelJS.Borders> => ({
  top: { style: 'thin', color: { argb: color } },
  bottom: { style: 'thin', color: { argb: color } },
  left: { style: 'thin', color: { argb: color } },
  right: { style: 'thin', color: { argb: color } },
});
const CURRENCY_FORMAT = '#,##0.00';

/**
 * Builds a two-worksheet Excel workbook: a detailed per-patient ledger and a
 * compact patient summary, both carried over from the previous SpreadsheetML
 * version's layout and styling.
 */
export async function buildPatientExpenseExcel(report: PatientExpenseReportData): Promise<Buffer> {
  const fromStr = report.from ? formatDateOnly(report.from) : 'Beginning';
  const toStr = report.to ? formatDateOnly(report.to) : 'Present';
  const genStr = formatDateTime(report.generatedAt);
  const grandTotal = report.grandTotal.toNumber();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AYUSH SARATHI';
  workbook.created = report.generatedAt;

  // ── Worksheet 1: Detailed Expense Ledger ──────────────────────────────
  const ledger = workbook.addWorksheet('Detailed Expense Ledger');
  ledger.columns = [{ width: 18 }, { width: 34 }, { width: 20 }, { width: 12 }, { width: 14 }, { width: 16 }];

  ledger.addRow(['AYUSH SARATHI']).getCell(1).font = { size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
  ledger.addRow(['Detailed Patient Expense Breakdown Report']).getCell(1).font = { size: 11, bold: true, color: { argb: 'FF374151' } };
  ledger.addRow([
    `Selected Period: ${report.periodLabel} (${fromStr} to ${toStr})  |  Generated: ${genStr}`,
  ]).getCell(1).font = { size: 10, italic: true, color: { argb: 'FF4B5563' } };
  ledger.addRow([]);

  const summaryRow = ledger.addRow(['Total Patient Expenses (Selected Period):', grandTotal]);
  summaryRow.getCell(1).font = { size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
  summaryRow.getCell(1).fill = FILL('FFDBEAFE');
  summaryRow.getCell(2).font = { size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
  summaryRow.getCell(2).fill = FILL('FFEFF6FF');
  summaryRow.getCell(2).numFmt = CURRENCY_FORMAT;
  summaryRow.getCell(2).alignment = { horizontal: 'right' };

  ledger.addRow([
    `Summary: ${report.totalPatients} Billed Patients  |  ${report.totalTransactions} Billable Activities (OPD, IPD/Bed, Lab, Therapy, Pharmacy)`,
  ]).getCell(1).font = { size: 10, italic: true, color: { argb: 'FF4B5563' } };
  ledger.addRow([]);

  if (report.patients.length === 0) {
    ledger.addRow(['No billable patient activities recorded for the selected period.']);
  } else {
    for (const p of report.patients) {
      const patientTotal = p.totalExpense.toNumber();

      const banner = ledger.addRow([
        `Patient: ${p.patient.name}  |  Employee ID: ${p.patient.employeeId}  |  UHID: ${p.patient.uhid}`,
      ]);
      banner.getCell(1).font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      banner.getCell(1).fill = FILL('FF1E40AF');
      ledger.mergeCells(banner.number, 1, banner.number, 6);

      const infoRow1 = ledger.addRow([
        'Patient Name',
        p.patient.name,
        'Employee ID',
        p.patient.employeeId,
        'Hospital UHID',
        p.patient.uhid,
      ]);
      [1, 3, 5].forEach((c) => {
        infoRow1.getCell(c).font = { size: 9, bold: true, color: { argb: 'FF4B5563' } };
        infoRow1.getCell(c).fill = FILL('FFF3F4F6');
      });

      const infoRow2 = ledger.addRow(['Department', p.patient.department || 'General', 'Total Patient Expense', patientTotal]);
      infoRow2.getCell(1).font = { size: 9, bold: true, color: { argb: 'FF4B5563' } };
      infoRow2.getCell(1).fill = FILL('FFF3F4F6');
      infoRow2.getCell(3).font = { size: 9, bold: true, color: { argb: 'FF4B5563' } };
      infoRow2.getCell(3).fill = FILL('FFF3F4F6');
      infoRow2.getCell(4).font = { size: 10, bold: true, color: { argb: 'FF1E40AF' } };
      infoRow2.getCell(4).fill = FILL('FFEFF6FF');
      infoRow2.getCell(4).numFmt = CURRENCY_FORMAT;

      const header = ledger.addRow(['Date', 'Service', 'Category', 'Quantity', 'Rate (₹)', 'Total (₹)']);
      header.eachCell((cell) => {
        cell.font = { size: 10, bold: true, color: { argb: 'FF1F2937' } };
        cell.fill = FILL('FFE5E7EB');
        cell.alignment = { horizontal: 'center' };
      });

      for (const t of p.transactions) {
        const row = ledger.addRow([
          formatDateTime(t.date),
          t.service,
          t.category,
          t.quantity.toNumber(),
          t.rate.toNumber(),
          t.total.toNumber(),
        ]);
        row.getCell(5).numFmt = CURRENCY_FORMAT;
        row.getCell(6).numFmt = CURRENCY_FORMAT;
        row.eachCell((cell) => (cell.border = THIN_BORDER('FFE5E7EB')));
      }

      const subtotal = ledger.addRow(['', '', '', '', `Patient Total Expense (${p.patient.name}):`, patientTotal]);
      subtotal.getCell(5).font = { size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
      subtotal.getCell(5).fill = FILL('FFEFF6FF');
      subtotal.getCell(5).alignment = { horizontal: 'right' };
      subtotal.getCell(6).font = { size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
      subtotal.getCell(6).fill = FILL('FFEFF6FF');
      subtotal.getCell(6).numFmt = CURRENCY_FORMAT;
      ledger.addRow([]);
    }
  }

  const grandRow = ledger.addRow([
    '',
    '',
    '',
    '',
    `OVERALL TOTAL EXPENSES OF ALL PATIENTS (${report.periodLabel.toUpperCase()}):`,
    grandTotal,
  ]);
  grandRow.getCell(5).font = { size: 11, bold: true, color: { argb: 'FF065F46' } };
  grandRow.getCell(5).fill = FILL('FFD1FAE5');
  grandRow.getCell(5).alignment = { horizontal: 'right' };
  grandRow.getCell(6).font = { size: 12, bold: true, color: { argb: 'FF065F46' } };
  grandRow.getCell(6).fill = FILL('FFD1FAE5');
  grandRow.getCell(6).numFmt = CURRENCY_FORMAT;

  // ── Worksheet 2: Patient Summary ──────────────────────────────────────
  const summary = workbook.addWorksheet('Patient Summary');
  summary.columns = [{ width: 24 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 12 }, { width: 18 }];

  summary.addRow(['ESIC HOSPITAL — PATIENT EXPENSE SUMMARY']).getCell(1).font = {
    size: 16,
    bold: true,
    color: { argb: 'FF1E3A8A' },
  };
  summary.addRow([`Period: ${report.periodLabel} (${fromStr} to ${toStr})  |  Generated: ${genStr}`]).getCell(1).font = {
    size: 10,
    italic: true,
    color: { argb: 'FF4B5563' },
  };
  summary.addRow([]);

  const summaryHeader = summary.addRow([
    'Patient Name',
    'Employee ID',
    'Hospital UHID',
    'Department',
    'Activities',
    'Total Expense (₹)',
  ]);
  summaryHeader.eachCell((cell) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FF1F2937' } };
    cell.fill = FILL('FFE5E7EB');
    cell.alignment = { horizontal: 'center' };
  });

  if (report.patients.length === 0) {
    summary.addRow(['No billable patient activities recorded for the selected period.']);
  } else {
    for (const p of report.patients) {
      const row = summary.addRow([
        p.patient.name,
        p.patient.employeeId,
        p.patient.uhid,
        p.patient.department || 'General',
        p.transactions.length,
        p.totalExpense.toNumber(),
      ]);
      row.getCell(6).numFmt = CURRENCY_FORMAT;
    }
  }

  const summaryGrand = summary.addRow(['', '', '', '', `OVERALL TOTAL EXPENSES (${report.periodLabel.toUpperCase()}):`, grandTotal]);
  summaryGrand.getCell(5).font = { size: 11, bold: true, color: { argb: 'FF065F46' } };
  summaryGrand.getCell(5).fill = FILL('FFD1FAE5');
  summaryGrand.getCell(5).alignment = { horizontal: 'right' };
  summaryGrand.getCell(6).font = { size: 12, bold: true, color: { argb: 'FF065F46' } };
  summaryGrand.getCell(6).fill = FILL('FFD1FAE5');
  summaryGrand.getCell(6).numFmt = CURRENCY_FORMAT;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
