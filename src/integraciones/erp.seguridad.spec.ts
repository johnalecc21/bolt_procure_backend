import {
  claveCifrado,
  cifrar,
  descifrar,
  firmaValida,
  firmar,
  ipPrivada,
  validarUrlWebhook,
} from './erp.seguridad';

describe('seguridad de la integración ERP', () => {
  it('cifra y descifra el secreto; otra clave no puede leerlo', () => {
    const clave = claveCifrado('k1');
    const c = cifrar('whsec_abc', clave);
    expect(c).not.toContain('whsec_abc');
    expect(descifrar(c, clave)).toBe('whsec_abc');
    expect(() => descifrar(c, claveCifrado('k2'))).toThrow();
  });

  it('firma HMAC sobre timestamp.cuerpo', () => {
    const f = firmar('s', '1700000000', '{"a":1}');
    expect(f).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(firmaValida('s', '1700000000', '{"a":1}', f)).toBe(true);
    expect(firmaValida('s', '1700000001', '{"a":1}', f)).toBe(false);
    expect(firmaValida('otro', '1700000000', '{"a":1}', f)).toBe(false);
  });

  it('reconoce redes privadas', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(ipPrivada(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111'])
      expect(ipPrivada(ip)).toBe(false);
  });

  it('valida la URL del webhook contra SSRF', async () => {
    const dns = (ips: string[]) => () => Promise.resolve(ips);
    expect(
      await validarUrlWebhook(
        'http://erp.acme.co/hook',
        false,
        dns(['8.8.8.8']),
      ),
    ).toMatch(/HTTPS/);
    expect(
      await validarUrlWebhook(
        'https://erp.acme.co/hook',
        false,
        dns(['10.0.0.5']),
      ),
    ).toMatch(/privada/);
    expect(
      await validarUrlWebhook('https://169.254.169.254/latest', false),
    ).toMatch(/privada/);
    expect(
      await validarUrlWebhook(
        'https://u:p@erp.acme.co',
        false,
        dns(['8.8.8.8']),
      ),
    ).toMatch(/usuario/);
    expect(
      await validarUrlWebhook(
        'https://erp.acme.co/hook',
        false,
        dns(['8.8.8.8']),
      ),
    ).toBeNull();
    expect(await validarUrlWebhook('http://localhost:4010/x', true)).toBeNull();
    expect(await validarUrlWebhook('http://localhost:4010/x', false)).toMatch(
      /HTTPS/,
    );
  });
});
