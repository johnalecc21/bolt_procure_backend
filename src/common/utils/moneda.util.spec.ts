import { Moneda } from '@prisma/client';
import { formatMonto } from './moneda.util';

describe('formatMonto', () => {
  it('appends the code to $-currencies so they are unambiguous', () => {
    expect(formatMonto(1500, Moneda.USD)).toBe('$1,500 USD');
    expect(formatMonto(2500000, Moneda.COP)).toMatch(/^\$\s?2\.500\.000 COP$/);
  });

  it('uses the real symbol for BRL', () => {
    expect(formatMonto(1000, Moneda.BRL)).toMatch(/^R\$\s?1\.000$/);
  });

  it('defaults to USD', () => {
    expect(formatMonto(10)).toBe('$10 USD');
  });
});
