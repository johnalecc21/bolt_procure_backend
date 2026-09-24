import { origenesPermitidos, urlFrontend } from './origenes';

describe('orígenes del frontend', () => {
  it('acepta una lista separada por comas y quita la barra final', () => {
    expect(
      origenesPermitidos(
        'https://app.procurex.co/, https://procurex.vercel.app',
      ),
    ).toEqual(['https://app.procurex.co', 'https://procurex.vercel.app']);
    expect(origenesPermitidos(undefined)).toEqual(['http://localhost:5173']);
  });

  it('la URL pública es APP_URL o el primer origen', () => {
    expect(urlFrontend(undefined, 'https://a.co,https://b.co')).toBe(
      'https://a.co',
    );
    expect(urlFrontend('https://c.co/', 'https://a.co')).toBe('https://c.co');
  });
});
