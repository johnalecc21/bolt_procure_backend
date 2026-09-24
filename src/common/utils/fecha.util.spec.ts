import { finDelDia } from './fecha.util';

describe('finDelDia', () => {
  it('interpreta una fecha sin hora como el final de ese día en el país', () => {
    expect(finDelDia('2026-10-01', 'CO').toISOString()).toBe('2026-10-02T04:59:59.000Z');
    expect(finDelDia('2026-10-01', 'MX').toISOString()).toBe('2026-10-02T05:59:59.000Z');
  });

  it('respeta un timestamp completo', () => {
    expect(finDelDia('2026-10-01T15:00:00Z').toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });
});
