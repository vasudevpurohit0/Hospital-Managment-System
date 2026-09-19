import { toCsv } from './csv.util';

describe('toCsv (regression: CSV/Excel formula injection)', () => {
  it('prefixes a string cell starting with = with a leading single-quote', () => {
    const csv = toCsv(['Name'], [['=cmd|\'/C calc\'!A1']]);
    expect(csv).toContain("'=cmd");
  });

  it('prefixes string cells starting with +, -, or @', () => {
    const csv = toCsv(['A', 'B', 'C'], [['+1+1', '-2+3', '@SUM(A1)']]);
    const [, dataLine] = csv.split('\r\n');
    const cells = dataLine.split(',');
    expect(cells[0].startsWith("'+")).toBe(true);
    expect(cells[1].startsWith("'-")).toBe(true);
    expect(cells[2].startsWith("'@")).toBe(true);
  });

  it('does NOT prefix a genuine negative number (typed as number, not string)', () => {
    const csv = toCsv(['Amount'], [[-500]]);
    const [, dataLine] = csv.split('\r\n');
    expect(dataLine).toBe('-500');
  });

  it('leaves an ordinary string untouched', () => {
    const csv = toCsv(['Name'], [['Ramesh Kumar']]);
    const [, dataLine] = csv.split('\r\n');
    expect(dataLine).toBe('Ramesh Kumar');
  });

  it('still quotes a value containing a comma after the formula-injection prefix is applied', () => {
    const csv = toCsv(['Name'], [['=HYPERLINK("http://evil","click"),extra']]);
    const [, dataLine] = csv.split('\r\n');
    expect(dataLine.startsWith('"\'=HYPERLINK')).toBe(true);
  });
});
