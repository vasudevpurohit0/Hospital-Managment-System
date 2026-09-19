import {
  generateMedicineTemplateXlsx,
  generateMedicineErrorReportXlsx,
  parseMedicineSpreadsheet,
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
});
