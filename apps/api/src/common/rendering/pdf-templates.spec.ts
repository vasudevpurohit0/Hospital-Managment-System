import { renderReceiptHtml } from './pdf-templates';
import { ReceiptDetailForPdf } from './pdf-templates.types';

/** V-16 regression: `primaryColor` is interpolated raw into a <style> block shared by every tenant's PDF renders. */
describe('pdf-templates (regression: V-16 — branding.primaryColor injection into the shared PDF renderer)', () => {
  const receipt: ReceiptDetailForPdf = {
    receiptNumber: 'RCPT/2026/000001',
    billingType: 'OPD',
    issuedAt: new Date('2026-09-19'),
    paymentMode: 'CASH',
    patient: { uhid: 'ESIC-2026-000001', employeeId: 'EMP-1001', name: 'Test Patient', employmentType: 'Permanent' },
    opdDepartment: 'General Medicine',
    collectedBy: 'Reception',
    lines: [{ description: 'Consultation', category: 'Consultation', quantity: '1', rate: '100.00', totalAmount: '100.00' }],
    totalAmount: '100.00',
    amountInWords: 'One Hundred Rupees Only',
  };

  it('uses a valid hex primaryColor verbatim', () => {
    const html = renderReceiptHtml({ hospitalName: 'Test Hospital', tagline: 'Test', primaryColor: '#123abc' }, receipt);
    expect(html).toContain('#123abc');
  });

  it('falls back to the safe default instead of interpolating a style-block-breakout payload', () => {
    const malicious = "red } </style><script>alert(document.cookie)</script><style>";
    const html = renderReceiptHtml({ hospitalName: 'Test Hospital', tagline: 'Test', primaryColor: malicious }, receipt);

    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('<script>');
    // Falls back to the documented default rather than rejecting the whole render.
    expect(html).toContain('#005691');
  });

  it('falls back to the safe default for a non-hex, non-malicious garbage value too', () => {
    const html = renderReceiptHtml({ hospitalName: 'Test Hospital', tagline: 'Test', primaryColor: 'not-a-color' }, receipt);
    expect(html).toContain('#005691');
    expect(html).not.toContain('not-a-color');
  });
});
