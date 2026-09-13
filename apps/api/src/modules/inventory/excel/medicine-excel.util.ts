import * as zlib from 'zlib';

// ── CRC32 Engine for standard ZIP packaging ────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipArchive(files: Record<string, string | Buffer>): Buffer {
  interface Entry {
    nameBuf: Buffer;
    localHeader: Buffer;
    compressedBuf: Buffer;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    offset: number;
  }

  const entries: Entry[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const uncompressedSize = contentBuf.length;
    const crc = crc32(contentBuf);
    const compressedBuf = zlib.deflateRawSync(contentBuf);
    const compressedSize = compressedBuf.length;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // compression: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5241, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    entries.push({
      nameBuf,
      localHeader,
      compressedBuf,
      crc,
      compressedSize,
      uncompressedSize,
      offset: currentOffset,
    });

    currentOffset += localHeader.length + compressedBuf.length;
  }

  const cdParts: Buffer[] = [];
  let cdSize = 0;
  for (const entry of entries) {
    const cdHeader = Buffer.alloc(46 + entry.nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(8, 10); // compression
    cdHeader.writeUInt16LE(0, 12); // mod time
    cdHeader.writeUInt16LE(0x5241, 14); // mod date
    cdHeader.writeUInt32LE(entry.crc, 16);
    cdHeader.writeUInt32LE(entry.compressedSize, 20);
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24);
    cdHeader.writeUInt16LE(entry.nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30); // extra len
    cdHeader.writeUInt16LE(0, 32); // comment len
    cdHeader.writeUInt16LE(0, 34); // disk num
    cdHeader.writeUInt16LE(0, 36); // internal attr
    cdHeader.writeUInt32LE(0, 38); // external attr
    cdHeader.writeUInt32LE(entry.offset, 42); // local header offset
    entry.nameBuf.copy(cdHeader, 46);

    cdParts.push(cdHeader);
    cdSize += cdHeader.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(currentOffset, 16);
  eocd.writeUInt16LE(0, 20);

  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(entry.localHeader);
    chunks.push(entry.compressedBuf);
  }
  chunks.push(...cdParts);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

function escapeXml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(index: number): string {
  let name = '';
  let idx = index;
  while (idx >= 0) {
    name = String.fromCharCode((idx % 26) + 65) + name;
    idx = Math.floor(idx / 26) - 1;
  }
  return name;
}

/**
 * Builds a standard, fully compliant .xlsx file.
 */
export function buildXlsx(sheetName: string, headers: string[], rows: (string | number)[][]): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Calibri"/><sz val="11"/><color rgb="FF1F2937"/></font>
    <font><name val="Calibri"/><sz val="11"/><b/><color rgb="FF111827"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="2">
    <xf fontId="0" fillId="0" borderId="0"/>
    <xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  let sheetData = '';
  // Header row (styled bold with light gray background)
  let rowXml = `<row r="1">`;
  headers.forEach((h, idx) => {
    const cellRef = `${colName(idx)}1`;
    rowXml += `<c r="${cellRef}" t="inlineStr" s="1"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowXml += `</row>`;
  sheetData += rowXml;

  // Data rows
  rows.forEach((r, rowIdx) => {
    const rowNum = rowIdx + 2;
    let rXml = `<row r="${rowNum}">`;
    r.forEach((val, colIdx) => {
      const cellRef = `${colName(colIdx)}${rowNum}`;
      rXml += `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
    });
    rXml += `</row>`;
    sheetData += rXml;
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetData}
  </sheetData>
</worksheet>`;

  return createZipArchive({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels,
    'xl/_rels/workbook.xml.rels': wbRels,
    'xl/workbook.xml': workbook,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
  });
}

/**
 * Generates the official downloadable Excel template with sample rows.
 */
export function generateMedicineTemplateXlsx(): Buffer {
  const headers = [
    'Generic Name *',
    'Brand Name',
    'Category *',
    'Strength *',
    'Dosage Form *',
  ];

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

function readZipFiles(buffer: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP/XLSX file format: End of Central Directory not found.');
  }

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let cdPos = cdOffset;
  for (let i = 0; i < totalEntries && cdPos < eocdOffset; i++) {
    if (buffer.readUInt32LE(cdPos) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(cdPos + 10);
    const compressedSize = buffer.readUInt32LE(cdPos + 20);
    const nameLen = buffer.readUInt16LE(cdPos + 28);
    const extraLen = buffer.readUInt16LE(cdPos + 30);
    const commentLen = buffer.readUInt16LE(cdPos + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdPos + 42);
    const fileName = buffer.toString('utf8', cdPos + 46, cdPos + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);
    if (compression === 0) {
      files[fileName] = compressedData.toString('utf8');
    } else if (compression === 8) {
      files[fileName] = zlib.inflateRawSync(compressedData).toString('utf8');
    }

    cdPos += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

function parseXlsxBuffer(buffer: Buffer): Array<{ rowNum: number; cells: string[] }> {
  const files = readZipFiles(buffer);

  const sharedStrings: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const sstXml = files['xl/sharedStrings.xml'];
    const siMatches = sstXml.match(/<si>(.*?)<\/si>/gs) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t[^>]*>(.*?)<\/t>/gs) || [];
      const text = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');
      sharedStrings.push(text);
    }
  }

  let sheetXml = files['xl/worksheets/sheet1.xml'];
  if (!sheetXml) {
    const sheetKey = Object.keys(files).find(
      (k) => k.startsWith('xl/worksheets/sheet') && k.endsWith('.xml'),
    );
    if (sheetKey) sheetXml = files[sheetKey];
  }

  if (!sheetXml) {
    throw new Error('No worksheet data found in the Excel workbook.');
  }

  const rows: Array<{ rowNum: number; cells: string[] }> = [];
  const rowMatches = sheetXml.match(/<row[^>]*>(.*?)<\/row>/gs) || [];

  for (const rowTag of rowMatches) {
    const rowMatch = rowTag.match(/r="(\d+)"/);
    const rowNum = rowMatch ? parseInt(rowMatch[1], 10) : rows.length + 1;

    const cells: string[] = [];
    const cellMatches = rowTag.match(/<c[^>]*>(.*?)<\/c>|<c[^>]*\/>/gs) || [];

    for (const cellXml of cellMatches) {
      const rMatch = cellXml.match(/r="([A-Z]+)(\d+)"/);
      const colLetters = rMatch ? rMatch[1] : '';

      let colIdx = 0;
      for (let i = 0; i < colLetters.length; i++) {
        colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 64);
      }
      colIdx = colIdx - 1;

      const tMatch = cellXml.match(/t="([^"]+)"/);
      const cellType = tMatch ? tMatch[1] : 'n';

      let val = '';
      if (cellType === 'inlineStr') {
        const t = cellXml.match(/<t[^>]*>(.*?)<\/t>/s);
        val = t ? t[1] : '';
      } else if (cellType === 's') {
        const v = cellXml.match(/<v>(.*?)<\/v>/);
        if (v) {
          const sIdx = parseInt(v[1], 10);
          val = sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : '';
        }
      } else {
        const v = cellXml.match(/<v>(.*?)<\/v>/);
        val = v ? v[1] : '';
      }

      val = val
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

      cells[colIdx] = val;
    }

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === undefined) cells[i] = '';
    }

    rows.push({ rowNum, cells });
  }

  return rows;
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

function parseXmlSpreadsheetBuffer(text: string): Array<{ rowNum: number; cells: string[] }> {
  const rows: Array<{ rowNum: number; cells: string[] }> = [];
  const rowMatches = text.match(/<Row[^>]*>(.*?)<\/Row>/gs) || [];

  for (let i = 0; i < rowMatches.length; i++) {
    const rowXml = rowMatches[i];
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<Cell[^>]*>(.*?)<\/Cell>/gs) || [];

    for (const cellXml of cellMatches) {
      const dataMatch = cellXml.match(/<Data[^>]*>(.*?)<\/Data>/s);
      const val = dataMatch ? dataMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      cells.push(val);
    }
    rows.push({ rowNum: i + 1, cells });
  }

  return rows;
}

/**
 * Universally parses any Excel (.xlsx, .xls, .csv) buffer into row objects.
 */
export function parseMedicineSpreadsheet(buffer: Buffer): ParsedMedicineRow[] {
  let rawRows: Array<{ rowNum: number; cells: string[] }>;

  // Check magic bytes for ZIP (.xlsx)
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    rawRows = parseXlsxBuffer(buffer);
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('<?xml') && text.includes('Workbook')) {
      rawRows = parseXmlSpreadsheetBuffer(text);
    } else {
      rawRows = parseCsvBuffer(text);
    }
  }

  if (rawRows.length === 0) {
    return [];
  }

  // Find header row
  let headerIndex = -1;
  let colMap = {
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
export function generateMedicineErrorReportXlsx(rows: RejectedImportRow[]): Buffer {
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
