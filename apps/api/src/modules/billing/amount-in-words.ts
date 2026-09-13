/**
 * Renders a rupee amount as words in the Indian numbering style (lakh/crore),
 * matching the reference receipt's "Three Hundred Zero Rupees And Zero Paisa".
 */
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds && rest) return `${ONES[hundreds]} Hundred ${twoDigits(rest)}`;
  if (hundreds) return `${ONES[hundreds]} Hundred`;
  return twoDigits(rest);
}

/** Whole rupees, in Indian numbering groups (crore / lakh / thousand / hundred). */
function integerToWords(n: number): string {
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1_000);
  n %= 1_000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(' ');
}

/** e.g. amountInWords(300) -> "Three Hundred Rupees And Zero Paise Only" */
export function amountInWords(amount: number | string): string {
  const value = Math.abs(Number(amount));
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  const rupeeWords = `${integerToWords(rupees)} Rupee${rupees === 1 ? '' : 's'}`;
  const paiseWords = paise > 0 ? `And ${integerToWords(paise)} Paise` : 'And Zero Paise';

  return `${rupeeWords} ${paiseWords} Only`;
}
