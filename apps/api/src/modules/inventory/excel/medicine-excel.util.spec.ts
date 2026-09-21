import {
  generateMedicineTemplateXlsx,
  generateMedicineErrorReportXlsx,
  parseMedicineSpreadsheet,
  MEDICINE_IMPORT_MAX_ROWS,
  MEDICINE_IMPORT_MAX_BYTES,
} from './medicine-excel.util';

describe('medicine-excel.util (regression: F-25 — now backed by exceljs, not a hand-rolled ZIP/OOXML writer/reader)', () => {
  it('round-trips the generated template through the parser', async () => {
    const buffer = await generateMedicineTemplateXlsx();
    expect(buffer.length).toBeGreaterThan(0);
    // ZIP local-file-header magic bytes -- confirms this is a real .xlsx, not text.
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);

    const rows = await parseMedicineSpreadsheet(buffer);
    expect(rows.length).toBe(7);
    expect(rows[0]).toEqual({
      rowNum: 2,
      genericName: 'Paracetamol',
      brandName: 'Crocin',
      category: 'Analgesics & Antipyretics',
      strength: '500mg',
      dosageForm: 'Tablet',
    });
    expect(rows[6].genericName).toBe('Metformin');
  });

  it('round-trips the error report through the parser using its own column headers', async () => {
    const buffer = await generateMedicineErrorReportXlsx([
      {
        rowNum: 5,
        genericName: 'Ibuprofen',
        brandName: 'Brufen',
        category: 'Analgesics',
        strength: '400mg',
        dosageForm: 'Tablet',
        status: 'DUPLICATE_EXISTING',
        reason: 'Already in Master (Skipped)',
      },
    ]);

    expect(buffer.length).toBeGreaterThan(0);
    const rows = await parseMedicineSpreadsheet(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].genericName).toBe('Ibuprofen');
    expect(rows[0].category).toBe('Analgesics');
  });

  it('still parses a plain CSV upload', async () => {
    const csv = 'Generic Name,Brand Name,Category,Strength,Dosage Form\nAspirin,Ecosprin,Antiplatelet,75mg,Tablet\n';
    const rows = await parseMedicineSpreadsheet(Buffer.from(csv, 'utf8'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rowNum: 2,
      genericName: 'Aspirin',
      brandName: 'Ecosprin',
      category: 'Antiplatelet',
      strength: '75mg',
      dosageForm: 'Tablet',
    });
  });

  it('returns an empty array for an empty CSV buffer', async () => {
    const rows = await parseMedicineSpreadsheet(Buffer.from('', 'utf8'));
    expect(rows).toEqual([]);
  });

  // Import size/row caps -- previously NOT VERIFIED per docs/developer/24-Technical-Debt-Risks.md
  // (only the Employee Directory bulk importer had these; Medicine import relied solely on the
  // global 10MB JSON body-parser limit in main.ts, with no per-import row cap and no friendly
  // size-specific error message). Mirrors employee-csv.util.ts's EMPLOYEE_IMPORT_MAX_* limits.
  describe('import safety limits (mirrors the Employee Directory bulk-import limits)', () => {
    it('rejects a buffer larger than MEDICINE_IMPORT_MAX_BYTES before parsing', async () => {
      const oversized = Buffer.alloc(MEDICINE_IMPORT_MAX_BYTES + 1, 'a');
      await expect(parseMedicineSpreadsheet(oversized)).rejects.toThrow(/too large/i);
    });

    it('accepts a buffer at exactly the byte limit', async () => {
      const header = 'Generic Name,Brand Name,Category,Strength,Dosage Form\n';
      const padding = 'a'.repeat(MEDICINE_IMPORT_MAX_BYTES - Buffer.byteLength(header, 'utf8'));
      const atLimit = Buffer.from(header + padding, 'utf8');
      expect(atLimit.byteLength).toBe(MEDICINE_IMPORT_MAX_BYTES);
      await expect(parseMedicineSpreadsheet(atLimit)).resolves.toBeDefined();
    });

    it('rejects a CSV with more than MEDICINE_IMPORT_MAX_ROWS data rows', async () => {
      const header = 'Generic Name,Brand Name,Category,Strength,Dosage Form\n';
      const row = 'Paracetamol,Crocin,Analgesics,500mg,Tablet\n';
      const csv = header + row.repeat(MEDICINE_IMPORT_MAX_ROWS + 1);
      await expect(parseMedicineSpreadsheet(Buffer.from(csv, 'utf8'))).rejects.toThrow(/too many rows/i);
    });

    it('accepts a CSV at exactly MEDICINE_IMPORT_MAX_ROWS data rows', async () => {
      const header = 'Generic Name,Brand Name,Category,Strength,Dosage Form\n';
      const row = 'Paracetamol,Crocin,Analgesics,500mg,Tablet\n';
      const csv = header + row.repeat(MEDICINE_IMPORT_MAX_ROWS);
      const rows = await parseMedicineSpreadsheet(Buffer.from(csv, 'utf8'));
      expect(rows).toHaveLength(MEDICINE_IMPORT_MAX_ROWS);
    });
  });
});
