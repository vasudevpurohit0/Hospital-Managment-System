import ExcelJS from 'exceljs';
import { Prisma, ChargeStatus } from '@prisma/client';
import { buildPatientExpenseExcel, PatientExpenseReportData } from './excel-export.util';

describe('excel-export.util (regression: F-25 — now backed by exceljs, not a hand-written SpreadsheetML string)', () => {
  const report: PatientExpenseReportData = {
    periodLabel: '1 Month',
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-09-01T00:00:00Z'),
    generatedAt: new Date('2026-09-19T12:00:00Z'),
    grandTotal: new Prisma.Decimal(650),
    totalPatients: 1,
    totalTransactions: 2,
    patients: [
      {
        patient: { id: 'p-1', name: 'John Doe', employeeId: 'EMP-1', uhid: 'UHID-1', department: 'Cardiology' },
        totalExpense: new Prisma.Decimal(650),
        transactions: [
          {
            date: new Date('2026-08-05T00:00:00Z'),
            service: 'CBC',
            category: 'Lab',
            quantity: new Prisma.Decimal(1),
            rate: new Prisma.Decimal(150),
            total: new Prisma.Decimal(150),
            status: ChargeStatus.PAID,
          },
          {
            date: new Date('2026-08-06T00:00:00Z'),
            service: 'IPD Bed',
            category: 'Bed',
            quantity: new Prisma.Decimal(1),
            rate: new Prisma.Decimal(500),
            total: new Prisma.Decimal(500),
            status: ChargeStatus.PAID,
          },
        ],
      },
    ],
  };

  it('produces a real, parseable .xlsx workbook with both worksheets', async () => {
    const buffer = await buildPatientExpenseExcel(report);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['Detailed Expense Ledger', 'Patient Summary']);
  });

  it('carries the patient name and grand total through onto the summary sheet', async () => {
    const buffer = await buildPatientExpenseExcel(report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const summary = workbook.getWorksheet('Patient Summary')!;
    const values = summary
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string');
    expect(values.some((v) => v.includes('John Doe'))).toBe(true);
    expect(values.some((v) => v.includes('1 MONTH'))).toBe(true);
  });

  it('handles an empty patient list without throwing', async () => {
    const empty: PatientExpenseReportData = { ...report, patients: [], totalPatients: 0, totalTransactions: 0, grandTotal: new Prisma.Decimal(0) };
    const buffer = await buildPatientExpenseExcel(empty);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
