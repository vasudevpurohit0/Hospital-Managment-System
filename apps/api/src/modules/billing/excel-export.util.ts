import { Prisma, ChargeStatus } from '@prisma/client';

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

function xmlEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

/**
 * Builds a professional, multi-worksheet Excel workbook in SpreadsheetML (XML Spreadsheet 2003).
 *
 * Sheet 1: "Detailed Expense Ledger"
 * - Report Title & Header Metadata
 * - Total Patient Expenses Executive Summary Card
 * - Detailed Patient-wise Sections (Name, Employee ID, UHID, Department, Total Expense)
 * - Complete Line-item Ledger (Date, Service, Category, Quantity, Rate, Total)
 * - Patient-wise Subtotals
 * - Overall Grand Total across ALL patients
 *
 * Sheet 2: "Patient Summary"
 * - Compact tabular summary of each patient's total expenses and charge counts
 * - Overall Total
 */
export function buildPatientExpenseExcel(report: PatientExpenseReportData): string {
  const fromStr = report.from ? formatDateOnly(report.from) : 'Beginning';
  const toStr = report.to ? formatDateOnly(report.to) : 'Present';
  const genStr = formatDateTime(report.generatedAt);
  const grandTotalFormatted = report.grandTotal.toFixed(2);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>Patient Expense Report</Title>
  <Subject>Detailed Patient Expense Breakdown</Subject>
  <Author>AYUSH SARATHI</Author>
  <Created>${xmlEscape(report.generatedAt.toISOString())}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1F2937"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="ReportTitle">
   <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="ReportSub">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#374151"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="ReportMeta">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#4B5563" ss:Italic="1"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="SummaryCardLabel">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryCardValue">
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
   </Borders>
  </Style>
  <Style ss:ID="PatientBanner">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E40AF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E3A8A"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E3A8A"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E3A8A"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E3A8A"/>
   </Borders>
  </Style>
  <Style ss:ID="InfoKey">
   <Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#4B5563"/>
   <Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="InfoVal">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#111827"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="InfoValAmount">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1E40AF"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="TableHeader">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1F2937"/>
   <Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#9CA3AF"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#4B5563"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D1D5DB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D1D5DB"/>
   </Borders>
  </Style>
  <Style ss:ID="CellDate">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#374151"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="CellText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#111827"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="CellQty">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#111827"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="CellCurrency">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#111827"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>
   </Borders>
  </Style>
  <Style ss:ID="SubtotalLabel">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#2563EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="SubtotalAmount">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#93C5FD"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#2563EB"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="GrandTotalLabel">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#065F46"/>
   <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#10B981"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#047857"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#6EE7B7"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#6EE7B7"/>
   </Borders>
  </Style>
  <Style ss:ID="GrandTotalAmount">
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#065F46"/>
   <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#10B981"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#047857"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#6EE7B7"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#6EE7B7"/>
   </Borders>
  </Style>
 </Styles>
`;

  // ──────────────────────────────────────────────────────────────────────────
  // WORKSHEET 1: Detailed Expense Ledger
  // ──────────────────────────────────────────────────────────────────────────
  xml += ` <Worksheet ss:Name="Detailed Expense Ledger">
  <Table>
   <Column ss:Width="115"/>
   <Column ss:Width="230"/>
   <Column ss:Width="130"/>
   <Column ss:Width="70"/>
   <Column ss:Width="95"/>
   <Column ss:Width="110"/>

   <!-- Report Title Header -->
   <Row ss:Height="24">
    <Cell ss:StyleID="ReportTitle" ss:MergeAcross="5"><Data ss:Type="String">AYUSH SARATHI</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:StyleID="ReportSub" ss:MergeAcross="5"><Data ss:Type="String">Detailed Patient Expense Breakdown Report</Data></Cell>
   </Row>
   <Row ss:Height="16">
    <Cell ss:StyleID="ReportMeta" ss:MergeAcross="5"><Data ss:Type="String">Selected Period: ${xmlEscape(report.periodLabel)} (${xmlEscape(fromStr)} to ${xmlEscape(toStr)})  |  Generated: ${xmlEscape(genStr)}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>

   <!-- Total Patient Expenses Summary Card -->
   <Row ss:Height="22">
    <Cell ss:StyleID="SummaryCardLabel" ss:MergeAcross="3"><Data ss:Type="String">Total Patient Expenses (Selected Period):</Data></Cell>
    <Cell ss:StyleID="SummaryCardValue" ss:MergeAcross="1"><Data ss:Type="Number">${grandTotalFormatted}</Data></Cell>
   </Row>
   <Row ss:Height="16">
    <Cell ss:StyleID="ReportMeta" ss:MergeAcross="5"><Data ss:Type="String">Summary: ${report.totalPatients} Billed Patients  |  ${report.totalTransactions} Billable Activities (OPD, IPD/Bed, Lab, Therapy, Pharmacy)</Data></Cell>
   </Row>
   <Row ss:Height="14"/>
`;

  if (report.patients.length === 0) {
    xml += `   <Row ss:Height="20">
    <Cell ss:StyleID="CellText" ss:MergeAcross="5"><Data ss:Type="String">No billable patient activities recorded for the selected period.</Data></Cell>
   </Row>
`;
  } else {
    for (const p of report.patients) {
      const patientTotal = p.totalExpense.toFixed(2);

      xml += `   <!-- Patient Header Banner -->
   <Row ss:Height="20">
    <Cell ss:StyleID="PatientBanner" ss:MergeAcross="5"><Data ss:Type="String">Patient: ${xmlEscape(p.patient.name)}  |  Employee ID: ${xmlEscape(p.patient.employeeId)}  |  UHID: ${xmlEscape(p.patient.uhid)}</Data></Cell>
   </Row>

   <!-- Patient Summary Info -->
   <Row ss:Height="18">
    <Cell ss:StyleID="InfoKey"><Data ss:Type="String">Patient Name</Data></Cell>
    <Cell ss:StyleID="InfoVal"><Data ss:Type="String">${xmlEscape(p.patient.name)}</Data></Cell>
    <Cell ss:StyleID="InfoKey"><Data ss:Type="String">Employee ID</Data></Cell>
    <Cell ss:StyleID="InfoVal"><Data ss:Type="String">${xmlEscape(p.patient.employeeId)}</Data></Cell>
    <Cell ss:StyleID="InfoKey"><Data ss:Type="String">Hospital UHID</Data></Cell>
    <Cell ss:StyleID="InfoVal"><Data ss:Type="String">${xmlEscape(p.patient.uhid)}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:StyleID="InfoKey"><Data ss:Type="String">Department</Data></Cell>
    <Cell ss:StyleID="InfoVal" ss:MergeAcross="2"><Data ss:Type="String">${xmlEscape(p.patient.department || 'General')}</Data></Cell>
    <Cell ss:StyleID="InfoKey"><Data ss:Type="String">Total Patient Expense</Data></Cell>
    <Cell ss:StyleID="InfoValAmount"><Data ss:Type="Number">${patientTotal}</Data></Cell>
   </Row>

   <!-- Column Headers -->
   <Row ss:Height="18">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Date</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Service</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Category</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Quantity</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rate (₹)</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Total (₹)</Data></Cell>
   </Row>
`;

      for (const t of p.transactions) {
        xml += `   <Row ss:Height="16">
    <Cell ss:StyleID="CellDate"><Data ss:Type="String">${xmlEscape(formatDateTime(t.date))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.service)}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(t.category)}</Data></Cell>
    <Cell ss:StyleID="CellQty"><Data ss:Type="Number">${t.quantity.toNumber()}</Data></Cell>
    <Cell ss:StyleID="CellCurrency"><Data ss:Type="Number">${t.rate.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="CellCurrency"><Data ss:Type="Number">${t.total.toFixed(2)}</Data></Cell>
   </Row>
`;
      }

      // Patient-wise Subtotal Row
      xml += `   <Row ss:Height="18">
    <Cell ss:StyleID="SubtotalLabel" ss:MergeAcross="4"><Data ss:Type="String">Patient Total Expense (${xmlEscape(p.patient.name)}):</Data></Cell>
    <Cell ss:StyleID="SubtotalAmount"><Data ss:Type="Number">${patientTotal}</Data></Cell>
   </Row>
   <Row ss:Height="12"/>
`;
    }
  }

  // Report Overall Grand Total
  xml += `   <!-- Overall Total -->
   <Row ss:Height="22">
    <Cell ss:StyleID="GrandTotalLabel" ss:MergeAcross="4"><Data ss:Type="String">OVERALL TOTAL EXPENSES OF ALL PATIENTS (${xmlEscape(report.periodLabel).toUpperCase()}):</Data></Cell>
    <Cell ss:StyleID="GrandTotalAmount"><Data ss:Type="Number">${grandTotalFormatted}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
`;

  // ──────────────────────────────────────────────────────────────────────────
  // WORKSHEET 2: Patient Summary
  // ──────────────────────────────────────────────────────────────────────────
  xml += ` <Worksheet ss:Name="Patient Summary">
  <Table>
   <Column ss:Width="160"/>
   <Column ss:Width="110"/>
   <Column ss:Width="130"/>
   <Column ss:Width="140"/>
   <Column ss:Width="90"/>
   <Column ss:Width="120"/>

   <Row ss:Height="24">
    <Cell ss:StyleID="ReportTitle" ss:MergeAcross="5"><Data ss:Type="String">ESIC HOSPITAL — PATIENT EXPENSE SUMMARY</Data></Cell>
   </Row>
   <Row ss:Height="16">
    <Cell ss:StyleID="ReportMeta" ss:MergeAcross="5"><Data ss:Type="String">Period: ${xmlEscape(report.periodLabel)} (${xmlEscape(fromStr)} to ${xmlEscape(toStr)})  |  Generated: ${xmlEscape(genStr)}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>

   <Row ss:Height="18">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Patient Name</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Employee ID</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Hospital UHID</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Department</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Activities</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Total Expense (₹)</Data></Cell>
   </Row>
`;

  if (report.patients.length === 0) {
    xml += `   <Row ss:Height="18">
    <Cell ss:StyleID="CellText" ss:MergeAcross="5"><Data ss:Type="String">No billable patient activities recorded for the selected period.</Data></Cell>
   </Row>
`;
  } else {
    for (const p of report.patients) {
      xml += `   <Row ss:Height="18">
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(p.patient.name)}</Data></Cell>
    <Cell ss:StyleID="CellDate"><Data ss:Type="String">${xmlEscape(p.patient.employeeId)}</Data></Cell>
    <Cell ss:StyleID="CellDate"><Data ss:Type="String">${xmlEscape(p.patient.uhid)}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${xmlEscape(p.patient.department || 'General')}</Data></Cell>
    <Cell ss:StyleID="CellQty"><Data ss:Type="Number">${p.transactions.length}</Data></Cell>
    <Cell ss:StyleID="CellCurrency"><Data ss:Type="Number">${p.totalExpense.toFixed(2)}</Data></Cell>
   </Row>
`;
    }
  }

  xml += `   <Row ss:Height="22">
    <Cell ss:StyleID="GrandTotalLabel" ss:MergeAcross="4"><Data ss:Type="String">OVERALL TOTAL EXPENSES (${xmlEscape(report.periodLabel).toUpperCase()}):</Data></Cell>
    <Cell ss:StyleID="GrandTotalAmount"><Data ss:Type="Number">${grandTotalFormatted}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;

  return xml;
}
