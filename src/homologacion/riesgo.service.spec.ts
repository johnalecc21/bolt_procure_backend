import { umbralAviso } from './riesgo.service';

describe('riesgo: avisos de vencimiento', () => {
  it('avisa una vez en 30, 15 y 7 días', () => {
    expect(umbralAviso(45)).toBeNull();
    expect(umbralAviso(30)).toBe(30);
    expect(umbralAviso(20)).toBe(30);
    expect(umbralAviso(15)).toBe(15);
    expect(umbralAviso(8)).toBe(15);
    expect(umbralAviso(7)).toBe(7);
    expect(umbralAviso(1)).toBe(7);
  });
});
