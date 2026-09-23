import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { escapeHtml, renderCorreo } from './plantilla';

function servicio(env: Record<string, string>) {
  return new EmailService({
    get: (k: string) => env[k],
  } as unknown as ConfigService);
}

describe('email', () => {
  afterEach(() => jest.restoreAllMocks());

  it('escapes user content in the HTML and keeps a plain-text version', () => {
    const { html, text } = renderCorreo({
      titulo: 'Nueva invitación',
      cuerpo: '<script>alert(1)</script> "Acme"',
      accionUrl: 'https://app.procurex.co/proveedor/invitaciones',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(text).toContain('https://app.procurex.co/proveedor/invitaciones');
    expect(escapeHtml(`a&b'`)).toBe('a&amp;b&#39;');
  });

  it('builds absolute links from APP_URL', () => {
    expect(
      servicio({ APP_URL: 'https://app.procurex.co/' }).url(
        '/cliente/aprobaciones',
      ),
    ).toBe('https://app.procurex.co/cliente/aprobaciones');
  });

  it('does not call the provider without an API key', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(
      servicio({}).enviarAhora('a@b.co', 'x', { titulo: 't', cuerpo: 'c' }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries server errors and stops on client errors', async () => {
    const svc = servicio({ RESEND_API_KEY: 'k' });
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      svc.enviarAhora('a@b.co', 'x', { titulo: 't', cuerpo: 'c' }),
    ).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy
      .mockReset()
      .mockResolvedValueOnce(new Response('bad', { status: 422 }));
    await expect(
      svc.enviarAhora('a@b.co', 'x', { titulo: 't', cuerpo: 'c' }),
    ).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
