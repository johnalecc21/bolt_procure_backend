import { EstadoContrato, EstadoHito, TipoContrato } from '@prisma/client';
import {
  esMarco,
  estadoHitoAutomatico,
  estadoPorVigencia,
  porcentajeAsignado,
  saldoMarco,
} from './contratos.rules';

const AHORA = new Date('2026-06-15T12:00:00Z');
const dias = (n: number) => new Date(AHORA.getTime() + n * 86_400_000);

describe('reglas de contratos', () => {
  it('marco = CONTRATO sin padre; su saldo descuenta las POs', () => {
    expect(
      esMarco({ tipo: TipoContrato.CONTRATO, contratoPadreId: null }),
    ).toBe(true);
    expect(esMarco({ tipo: TipoContrato.PO, contratoPadreId: 'm' })).toBe(
      false,
    );
    expect(saldoMarco(1000, [{ monto: 300 }, { monto: 200 }])).toBe(500);
  });

  it('estado por vigencia', () => {
    expect(estadoPorVigencia(dias(-1), AHORA)).toBe(EstadoContrato.VENCIDO);
    expect(estadoPorVigencia(dias(20), AHORA)).toBe(EstadoContrato.POR_VENCER);
    expect(estadoPorVigencia(dias(90), AHORA)).toBe(EstadoContrato.ACTIVO);
  });

  it('hitos: atrasado tras su día, en riesgo a 3 días, completados intactos', () => {
    const h = (estado: EstadoHito, d: number) =>
      estadoHitoAutomatico({ estado, comprometido: dias(d) }, AHORA);
    expect(h(EstadoHito.PENDIENTE, -2)).toBe(EstadoHito.ATRASADO);
    expect(h(EstadoHito.PENDIENTE, 0)).toBe(EstadoHito.EN_RIESGO); // today: not late yet
    expect(h(EstadoHito.PENDIENTE, 2)).toBe(EstadoHito.EN_RIESGO);
    expect(h(EstadoHito.PENDIENTE, 10)).toBe(EstadoHito.PENDIENTE);
    expect(h(EstadoHito.EN_RIESGO, 10)).toBe(EstadoHito.EN_RIESGO);
    expect(h(EstadoHito.COMPLETADO, -20)).toBe(EstadoHito.COMPLETADO);
  });

  it('porcentaje asignado sin contar el hito que se edita', () => {
    const hitos = [
      { id: 'a', porcentaje: 30 },
      { id: 'b', porcentaje: 40 },
    ];
    expect(porcentajeAsignado(hitos)).toBe(70);
    expect(porcentajeAsignado(hitos, 'b')).toBe(30);
  });
});
