import {
  carpeta,
  extension,
  extensionPermitida,
  urlSegura,
} from './vitrina.rules';

describe('vitrina rules', () => {
  it('reads the extension case-insensitively', () => {
    expect(extension('Brochure 2026.PDF')).toBe('pdf');
    expect(extension('sin-extension')).toBe('');
  });

  it('only allows images for the gallery and catalog photos, PDFs for documents', () => {
    expect(extensionPermitida('IMAGEN', 'planta.webp')).toBe(true);
    expect(extensionPermitida('ITEM', 'producto.JPG')).toBe(true);
    expect(extensionPermitida('IMAGEN', 'brochure.pdf')).toBe(false);
    expect(extensionPermitida('BROCHURE', 'brochure.pdf')).toBe(true);
    expect(extensionPermitida('CATALOGO', 'catalogo.docx')).toBe(false);
    expect(extensionPermitida('IMAGEN', 'script.svg')).toBe(false);
  });

  it('scopes each use under the proveedor folder', () => {
    expect(carpeta('P-1', 'BROCHURE')).toBe('P-1/brochure/');
    expect(carpeta('P-1', 'ITEM')).toBe('P-1/item/');
  });

  it('rejects non-http links', () => {
    expect(urlSegura('https://youtu.be/abc')).toBe(true);
    expect(urlSegura('javascript:alert(1)')).toBe(false);
    expect(urlSegura('no es url')).toBe(false);
    expect(urlSegura(null)).toBe(true);
  });
});
