import { ReceiptDetailForPdf, LabReportForPdf, HospitalBranding, PatientHistoryForPdf } from './pdf-templates.types';

const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/**
 * V-16: interpolated raw into a <style> block, so escapeHtml() (an HTML-text
 * escaper) isn't the right defense here -- a value never falls through to
 * the DOM as text, it's CSS source. `UpdateBrandingDto` now validates this
 * shape at write time, but this render site (a single, shared, long-lived
 * Puppeteer instance backing every tenant's receipts/reports) still
 * verifies it independently rather than trusting that every row already in
 * the database was written after that validation existed.
 */
const safeColor = (color: unknown, fallback: string): string =>
  typeof color === 'string' && SAFE_HEX_COLOR.test(color) ? color : fallback;

function shell(branding: HospitalBranding, title: string, body: string): string {
  const primaryColor = safeColor(branding.primaryColor, '#005691');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .masthead { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${primaryColor}; padding-bottom: 10px; margin-bottom: 14px; }
  .masthead h1 { font-size: 18px; margin: 0; color: ${primaryColor}; }
  .masthead .tagline { font-size: 11px; color: #555; }
  .masthead .doc-title { text-align: right; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 11.5px; }
  th { background: #f2f2f2; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; font-size: 11.5px; }
  .meta-grid div span.label { color: #666; display: inline-block; min-width: 110px; }
  .section-title { font-weight: bold; font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .totals { margin-top: 10px; width: 260px; margin-left: auto; }
  .totals td { border: none; padding: 3px 0; }
  .totals tr.grand td { border-top: 2px solid #333; font-weight: bold; padding-top: 6px; }
  .signature-row { display: flex; justify-content: space-between; margin-top: 40px; }
  .signature-box { text-align: center; font-size: 11px; }
  .signature-box .line { border-top: 1px solid #333; width: 160px; margin-bottom: 4px; }
  .flag-high, .flag-low, .flag-critical { font-weight: bold; }
  .flag-high { color: #b45309; }
  .flag-low { color: #1d4ed8; }
  .flag-critical { color: #b91c1c; }
  footer.pagefoot { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9px; color: #888; text-align: center; padding: 4px 0; }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <h1>${escapeHtml(branding.hospitalName)}</h1>
      <div class="tagline">${escapeHtml(branding.tagline)}</div>
    </div>
    <div class="doc-title">${escapeHtml(title)}</div>
  </div>
  ${body}
</body>
</html>`;
}

export function renderReceiptHtml(branding: HospitalBranding, r: ReceiptDetailForPdf): string {
  const rows = r.lines
    .map(
      (l, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(l.category)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">₹${l.rate}</td>
        <td class="num">₹${l.totalAmount}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <div class="meta-grid">
      <div><span class="label">Receipt No.</span>${escapeHtml(r.receiptNumber)}</div>
      <div><span class="label">Date</span>${new Date(r.issuedAt).toLocaleString('en-IN')}</div>
      <div><span class="label">UHID</span>${escapeHtml(r.patient.uhid ?? '—')}</div>
      <div><span class="label">Billing Type</span>${escapeHtml(r.billingType)}</div>
      <div><span class="label">Patient Name</span>${escapeHtml(r.patient.name)}</div>
      <div><span class="label">Payment Mode</span>${escapeHtml(r.paymentMode)}</div>
      <div><span class="label">Employee ID</span>${escapeHtml(r.patient.employeeId)}</div>
      <div><span class="label">Department</span>${escapeHtml(r.opdDepartment ?? '—')}</div>
      <div><span class="label">Employment Type</span>${escapeHtml(r.patient.employmentType)}</div>
      <div><span class="label">Collected By</span>${escapeHtml(r.collectedBy ?? '—')}</div>
    </div>
    <div class="section-title">Service Details</div>
    <table>
      <thead><tr><th>Sl.No</th><th>Category</th><th>Service Name</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr class="grand"><td>Total Amount</td><td class="num">₹${r.totalAmount}</td></tr>
    </table>
    <p style="margin-top:14px;"><strong>Amount in Words:</strong> ${escapeHtml(r.amountInWords)}</p>
    <div class="signature-row">
      <div></div>
      <div class="signature-box"><div class="line"></div>Authorised Signature<br>${escapeHtml(r.collectedBy ?? '')}</div>
    </div>
  `;

  return shell(branding, 'OPD Bill Receipt — Original', body);
}

export function renderLabReportHtml(branding: HospitalBranding, r: LabReportForPdf): string {
  const panels = r.panels
    .map((panel) => {
      const rows = panel.results
        .map((res) => {
          const flagClass = res.flag !== 'NORMAL' ? ` class="flag-${res.flag.toLowerCase()}"` : '';
          return `<tr>
            <td>${escapeHtml(res.groupLabel ? `${res.groupLabel} — ${res.parameter}` : res.parameter)}</td>
            <td${flagClass}>${escapeHtml(res.value)}${res.flag !== 'NORMAL' ? ` (${res.flag})` : ''}</td>
            <td>${escapeHtml(res.unit ?? '')}</td>
            <td>${escapeHtml(res.range ?? '—')}</td>
          </tr>`;
        })
        .join('');
      return `
        <div class="section-title">${escapeHtml(panel.testName)} — ${escapeHtml(panel.discipline)}</div>
        <table>
          <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');

  const body = `
    <div class="meta-grid">
      <div><span class="label">Lab No.</span>${escapeHtml(r.labNumber)}</div>
      <div><span class="label">Report Date</span>${new Date(r.reportDate).toLocaleString('en-IN')}</div>
      <div><span class="label">UHID</span>${escapeHtml(r.patient.uhid ?? '—')}</div>
      <div><span class="label">Sample Date</span>${r.sampleDate ? new Date(r.sampleDate).toLocaleString('en-IN') : '—'}</div>
      <div><span class="label">Patient Name</span>${escapeHtml(r.patient.name)}</div>
      <div><span class="label">Referring Doctor</span>${escapeHtml(r.referringDoctor)}</div>
      <div><span class="label">Age / Sex</span>${r.patient.age ?? '—'} / ${escapeHtml(r.patient.gender ?? '—')}</div>
      <div><span class="label">OPD/IPD Ref.</span>${escapeHtml(r.opdOrIpdReference ?? '—')}</div>
    </div>
    ${panels}
    <p style="margin-top:14px; font-size:10.5px; color:#555;"><strong>Note:</strong> (L) - Low, (H) - High. All tests should be clinically correlated.</p>
    <p style="text-align:center; font-weight:bold; letter-spacing:2px; margin:18px 0;">*** End Of Report ***</p>
    <div class="signature-row">
      <div class="signature-box"><div class="line"></div>Technician</div>
      <div class="signature-box"><div class="line"></div>Pathologist<br>${escapeHtml(r.verification.pathologist)}</div>
    </div>
  `;

  return shell(branding, 'Laboratory Report', body);
}

const fmtDateTime = (iso: string | null | undefined, recorded: boolean): string => {
  if (!iso || !recorded) return 'Time not recorded';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${datePart} • ${timePart}`;
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  REGISTRATION: 'Registration',
  VISIT: 'Visit',
  QUEUE: 'Queue',
  CONSULTATION: 'Consultation',
  LAB_ORDER: 'Lab Order',
  LAB_RESULT: 'Lab Result',
  PRESCRIPTION: 'Prescription',
  MEDICINE_DISPENSED: 'Medicine Dispensed',
  PROCEDURE: 'Procedure',
  THERAPY_SESSION: 'Therapy',
  ADMISSION: 'Admission',
  BED_MOVEMENT: 'Bed Movement',
  PROGRESS_NOTE: 'Progress Note',
  DISCHARGE: 'Discharge',
  PAYMENT: 'Payment',
};

/**
 * The complete patient clinical report PDF (Feature: "Build Complete Patient
 * Clinical Timeline, Treatment History & Downloadable PDF"). Every row here
 * is exactly what `PatientHistoryService.getPatientTimeline` returned —
 * "Time not recorded" is rendered verbatim wherever `timeRecorded` is false,
 * never a guessed date.
 */
export function renderPatientHistoryHtml(branding: HospitalBranding, r: PatientHistoryForPdf): string {
  const summaryCells = [
    ['Total Visits', r.summary.totalVisits],
    ['Total Admissions', r.summary.totalAdmissions],
    ['Total Consultations', r.summary.totalConsultations],
    ['Total Lab Orders', r.summary.totalLabOrders],
    ['Total Prescriptions', r.summary.totalPrescriptions],
    ['Total Medicines', r.summary.totalMedicines],
    ['Total Procedures', r.summary.totalProcedures],
    ['Total Therapy Sessions', r.summary.totalTherapySessions],
    ...(r.billing.authorized ? [['Total Bills', r.summary.totalBills] as [string, number]] : []),
  ]
    .map(([label, value]) => `<div class="stat-box"><div class="stat-value">${value}</div><div class="stat-label">${escapeHtml(label)}</div></div>`)
    .join('');

  const timelineRows = r.events
    .map(
      (e) => `<tr>
        <td style="white-space:nowrap;">${fmtDateTime(e.timestamp, e.timeRecorded)}</td>
        <td>${escapeHtml(EVENT_TYPE_LABEL[e.type] ?? e.type)}</td>
        <td>
          <strong>${escapeHtml(e.title)}</strong>
          ${e.status ? `<br><span style="color:#666;">Status: ${escapeHtml(e.status)}</span>` : ''}
        </td>
        <td>${escapeHtml(e.department ?? e.location ?? '—')}</td>
        <td>${escapeHtml(e.performedBy ?? '—')}${e.performedByRole ? ` <span style="color:#888;">(${escapeHtml(e.performedByRole)})</span>` : ''}</td>
      </tr>`,
    )
    .join('');

  const stageLabel: Record<string, string> = { PRESCRIBED: 'Prescribed', DISPENSED: 'Dispensed', ADMINISTERED: 'Administered' };
  const medicationRows = r.medicationHistory
    .map(
      (m) => `<tr>
        <td style="white-space:nowrap;">${fmtDateTime(m.timestamp, m.timeRecorded)}</td>
        <td>${escapeHtml(m.medicineName)}${m.medicineType === 'CUSTOM' ? ' <span style="font-size:9px;color:#b45309;">(Custom)</span>' : ''}</td>
        <td>${escapeHtml(stageLabel[m.stage] ?? m.stage)}</td>
        <td>${m.quantity !== null ? escapeHtml(String(m.quantity)) : escapeHtml([m.dose, m.frequency, m.duration].filter(Boolean).join(' · ') || '—')}</td>
        <td>${escapeHtml(m.by ?? (m.notRecordedReason ? 'Not recorded' : '—'))}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <div class="section-title">Patient Information</div>
    <div class="meta-grid">
      <div><span class="label">UHID</span>${escapeHtml(r.patient.uhid ?? '—')}</div>
      <div><span class="label">Employee ID</span>${escapeHtml(r.patient.employeeId)}</div>
      <div><span class="label">Name</span>${escapeHtml(r.patient.name)}</div>
      <div><span class="label">Age / Gender</span>${escapeHtml(r.patient.age)} / ${escapeHtml(r.patient.gender)}</div>
      <div><span class="label">Date of Birth</span>${escapeHtml(r.patient.dob)}</div>
      <div><span class="label">Employment Type</span>${escapeHtml(r.patient.employmentType)}</div>
      <div><span class="label">Contact</span>${escapeHtml(r.patient.mobile)}</div>
      <div><span class="label">Address</span>${escapeHtml(r.patient.address)}</div>
      <div><span class="label">Hospital</span>${escapeHtml(r.hospitalName)}</div>
      <div><span class="label">Report Generated</span>${new Date(r.generatedAt).toLocaleString('en-IN')}</div>
    </div>

    <div class="section-title">Report Period</div>
    <p style="margin:0 0 10px;">
      ${r.period.from ? new Date(r.period.from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
      &nbsp;to&nbsp;
      ${r.period.to ? new Date(r.period.to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
    </p>

    <div class="section-title">Summary</div>
    <div class="stat-grid">${summaryCells}</div>

    <div class="section-title" style="page-break-before:always;">Complete Clinical Timeline</div>
    <table>
      <thead><tr><th style="width:16%;">Date &amp; Time</th><th style="width:12%;">Type</th><th>Event</th><th style="width:16%;">Department / Location</th><th style="width:16%;">By</th></tr></thead>
      <tbody>${timelineRows || '<tr><td colspan="5" style="text-align:center;color:#888;">No events recorded.</td></tr>'}</tbody>
    </table>

    <div class="section-title" style="page-break-before:always;">Medication History — Prescribed / Dispensed / Administered</div>
    <table>
      <thead><tr><th style="width:16%;">Date &amp; Time</th><th>Medicine</th><th style="width:14%;">Event</th><th style="width:22%;">Dose / Frequency / Duration or Qty</th><th style="width:16%;">By</th></tr></thead>
      <tbody>${medicationRows || '<tr><td colspan="5" style="text-align:center;color:#888;">No medicines recorded.</td></tr>'}</tbody>
    </table>
    <p style="margin-top:8px; font-size:10px; color:#666;">"Administered" rows read "Not recorded" for every medicine — this system does not currently track medication administration (MAR) separately from dispensing.</p>

    ${
      r.billing.authorized
        ? `<div class="section-title" style="page-break-before:always;">Billing Summary</div>
    <table class="totals">
      <tr><td>Total Charges</td><td class="num">₹${r.billing.total.toFixed(2)}</td></tr>
      <tr><td>Paid</td><td class="num">₹${r.billing.paid.toFixed(2)}</td></tr>
      <tr class="grand"><td>Outstanding</td><td class="num">₹${r.billing.pending.toFixed(2)}</td></tr>
    </table>`
        : `<div class="section-title" style="page-break-before:always;">Billing Summary</div>
    <p style="color:#888;">Not authorized to view billing information.</p>`
    }
  `;

  return shell(
    branding,
    'Patient Clinical Report',
    `<style>.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}.stat-box{border:1px solid #ddd;border-radius:4px;padding:8px;text-align:center;}.stat-value{font-size:16px;font-weight:bold;}.stat-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.03em;}</style>${body}`,
  );
}

export interface StatementForPdf {
  patient: { uhid: string | null; name: string; employeeId: string };
  period: { from?: string; to?: string };
  summary: { totalAmount: string; paidAmount: string; outstandingAmount: string };
  transactions: {
    date: string;
    service: string;
    category: string;
    quantity: string;
    rate: string;
    totalAmount: string;
  }[];
}

export function renderStatementHtml(branding: HospitalBranding, s: StatementForPdf): string {
  const rows = s.transactions
    .map(
      (t) => `<tr>
        <td>${new Date(t.date).toLocaleDateString('en-IN')}</td>
        <td>${escapeHtml(t.category)}</td>
        <td>${escapeHtml(t.service)}</td>
        <td class="num">${t.quantity}</td>
        <td class="num">₹${t.rate}</td>
        <td class="num">₹${t.totalAmount}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <div class="meta-grid">
      <div><span class="label">Patient Name</span>${escapeHtml(s.patient.name)}</div>
      <div><span class="label">UHID</span>${escapeHtml(s.patient.uhid ?? '—')}</div>
      <div><span class="label">Employee ID</span>${escapeHtml(s.patient.employeeId)}</div>
      <div><span class="label">Period</span>${escapeHtml(s.period.from ?? 'inception')} – ${escapeHtml(s.period.to ?? 'date')}</div>
    </div>
    <div class="section-title">Transaction History</div>
    <table>
      <thead><tr><th>Date</th><th>Department</th><th>Service</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Total Charges</td><td class="num">₹${s.summary.totalAmount}</td></tr>
      <tr><td>Paid</td><td class="num">₹${s.summary.paidAmount}</td></tr>
      <tr class="grand"><td>Outstanding</td><td class="num">₹${s.summary.outstandingAmount}</td></tr>
    </table>
  `;

  return shell(branding, 'Patient Financial Statement', body);
}
