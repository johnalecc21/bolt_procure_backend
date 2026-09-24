import { EstadoPago } from '@prisma/client';
import {
  calcularProntoPago,
  estadoEfectivo,
  fechaPactadaDesde,
} from './pagos.rules';

describe('reglas de pagos', () => {
  it('pro-rates the early-payment discount at 1.5% per 30 days', () => {
    const pactada = new Date(2026, 5, 30);
    const r = calcularProntoPago(1_000_000, pactada, new Date(2026, 4, 31));
    expect(r.dias).toBe(30);
    expect(r.descuentoPct).toBeCloseTo(0.015);
    expect(r.montoNeto).toBe(985_000);
    expect(r.descuento).toBe(15_000);
  });

  it('shows overdue payments as VENCIDO without waiting for the cron', () => {
    const ayer = new Date(Date.now() - 86_400_000);
    expect(estadoEfectivo(EstadoPago.PENDIENTE, ayer)).toBe(EstadoPago.VENCIDO);
    expect(estadoEfectivo(EstadoPago.PAGADO, ayer)).toBe(EstadoPago.PAGADO);
  });

  it('starts the payment term on the filing date', () => {
    expect(fechaPactadaDesde(new Date(2026, 0, 10), 30)).toEqual(
      new Date(2026, 1, 9),
    );
  });
});
