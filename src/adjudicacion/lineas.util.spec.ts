import { calcularLineas, subtotalLinea } from './lineas.util';
import { resultadoProveedor } from './resultado.util';

describe('calcularLineas', () => {
  const items = [
    { id: 'a', cantidad: 10 },
    { id: 'b', cantidad: 2.5 },
    { id: 'c', cantidad: 1 },
  ];
  const precios = [
    { itemId: 'a', precioUnitario: 100 },
    { itemId: 'b', precioUnitario: 40 },
  ];

  it('prices the awarded lines from the offer', () => {
    const r = calcularLineas(items, precios, ['a'], 1100);
    expect(r).toEqual({
      precioFinal: 1000,
      lineas: [
        { itemId: 'a', cantidad: 10, precioUnitario: 100, subtotal: 1000 },
      ],
    });
  });

  it('rejects a line the proveedor did not quote', () => {
    expect(calcularLineas(items, precios, ['a', 'c'], 1100)).toBeNull();
  });

  it('scales lines by the negotiated bid; all quoted lines = exactly the bid', () => {
    const todo = calcularLineas(items, precios, ['a', 'b'], 1100, 990);
    expect(todo?.precioFinal).toBe(990);
    expect(todo?.lineas.map((l) => l.precioUnitario)).toEqual([90, 36]);
    const parte = calcularLineas(items, precios, ['b'], 1100, 990);
    expect(parte?.precioFinal).toBe(subtotalLinea(2.5, 36));
  });
});

describe('resultadoProveedor', () => {
  const adj = (proveedorId: string, firmado: boolean, confirmada = true) => ({
    proveedorId,
    precioFinal: 100,
    confirmada,
    firmado,
  });

  it('pending until decided, then selected, then won', () => {
    expect(resultadoProveedor([], 'p').resultado).toBe('pendiente');
    expect(resultadoProveedor([adj('p', false)], 'p').resultado).toBe(
      'seleccionado',
    );
    expect(resultadoProveedor([adj('p', true)], 'p').resultado).toBe('ganado');
  });

  it('only lost once every split award is signed without it', () => {
    const parcial = [adj('x', true), adj('y', false)];
    expect(resultadoProveedor(parcial, 'p').resultado).toBe('pendiente');
    const firmado = [adj('x', true), adj('y', true)];
    const r = resultadoProveedor(firmado, 'p');
    expect(r.resultado).toBe('perdido');
    expect(r.parcial).toBe(true);
    expect(r.precioComparable).toBeNull();
    expect(resultadoProveedor(firmado, 'y').resultado).toBe('ganado');
  });
});
