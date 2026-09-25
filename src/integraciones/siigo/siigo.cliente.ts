/**
 * Minimal Siigo Nube API client: token per company (24 h, refreshed early
 * and on a 401), calls spaced to stay under the 100 requests/minute limit,
 * and Siigo's error bodies turned into readable messages.
 */

const TIMEOUT_MS = 60_000;
/** ~90 calls/min per company: under Siigo's 100/min production limit. */
const ESPACIO_MS = 650;

export class ErrorSiigo extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface Token {
  valor: string;
  vence: number;
  llave: string;
}

export interface CredencialesSiigo {
  usuario: string;
  accessKey: string;
}

export class SiigoCliente {
  private static tokens = new Map<string, Token>();
  private static colas = new Map<string, Promise<void>>();

  constructor(
    private readonly baseUrl: string,
    private readonly partnerId: string,
    private readonly companyId: string,
    private readonly cred: CredencialesSiigo,
  ) {}

  /** Forget cached tokens (credentials changed). */
  static olvidar(companyId: string) {
    SiigoCliente.tokens.delete(companyId);
  }

  private get llave() {
    return `${this.cred.usuario}:${this.cred.accessKey.slice(-6)}`;
  }

  private async turno() {
    const previo = SiigoCliente.colas.get(this.companyId) ?? Promise.resolve();
    let liberar!: () => void;
    const mio = new Promise<void>((r) => (liberar = r));
    SiigoCliente.colas.set(
      this.companyId,
      previo.then(() => mio),
    );
    await previo;
    setTimeout(liberar, ESPACIO_MS);
  }

  private async token(forzar = false) {
    const t = SiigoCliente.tokens.get(this.companyId);
    if (!forzar && t && t.llave === this.llave && t.vence > Date.now())
      return t.valor;
    await this.turno();
    const res = await this.fetch('/auth', {
      method: 'POST',
      body: JSON.stringify({
        username: this.cred.usuario,
        access_key: this.cred.accessKey,
      }),
    });
    const json = (await this.json(res)) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !json.access_token)
      throw new ErrorSiigo(
        res.status === 401 || res.status === 400
          ? 'Siigo rechazó el usuario o la access key.'
          : `No se pudo autenticar en Siigo: ${mensajeError(json, res.status)}`,
        res.status,
      );
    SiigoCliente.tokens.set(this.companyId, {
      valor: json.access_token,
      // Refresh 10 minutes before it expires.
      vence: Date.now() + ((json.expires_in ?? 86_400) - 600) * 1000,
      llave: this.llave,
    });
    return json.access_token;
  }

  private fetch(path: string, init: RequestInit & { token?: string }) {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'Partner-Id': this.partnerId,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
    });
  }

  private async json(res: Response): Promise<unknown> {
    const texto = await res.text().catch(() => '');
    if (!texto) return {};
    try {
      return JSON.parse(texto);
    } catch {
      return { mensaje: texto.slice(0, 300) };
    }
  }

  async pedir<T>(
    metodo: 'GET' | 'POST' | 'PUT',
    path: string,
    opciones: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opciones.query ?? {}))
      if (typeof v === 'string' || typeof v === 'number')
        if (v !== '') qs.set(k, String(v));
    const url = qs.size ? `${path}?${qs.toString()}` : path;
    for (let intento = 0; ; intento++) {
      const token = await this.token(intento > 0);
      await this.turno();
      let res: Response;
      try {
        res = await this.fetch(url, {
          method: metodo,
          token,
          ...(opciones.body !== undefined
            ? { body: JSON.stringify(opciones.body) }
            : {}),
        });
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'TimeoutError'
            ? 'Siigo no respondió a tiempo.'
            : `No se pudo conectar con Siigo: ${err instanceof Error ? err.message : String(err)}`;
        throw new ErrorSiigo(msg);
      }
      if (res.status === 401 && intento === 0) continue;
      const json = await this.json(res);
      if (res.ok) return json as T;
      if (res.status === 429)
        throw new ErrorSiigo(
          'Siigo limitó las solicitudes (100 por minuto); se reintentará.',
          429,
        );
      throw new ErrorSiigo(
        `Siigo respondió ${res.status}: ${mensajeError(json, res.status)}`,
        res.status,
      );
    }
  }

  get<T>(path: string, query?: Record<string, unknown>) {
    return this.pedir<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown) {
    return this.pedir<T>('POST', path, { body });
  }
}

/** Siigo errors: { Status, Errors: [{ Code, Message, Params }] }. */
export function mensajeError(json: unknown, status: number) {
  const j = (json ?? {}) as {
    Errors?: { Code?: string; Message?: string; Params?: string[] }[];
    errors?: { Code?: string; Message?: string; Params?: string[] }[];
    mensaje?: string;
    message?: string;
  };
  const errores = j.Errors ?? j.errors;
  if (errores?.length)
    return errores
      .slice(0, 3)
      .map(
        (e) =>
          `${e.Message ?? e.Code ?? 'error'}${e.Params?.length ? ` (${e.Params.join(', ')})` : ''}`,
      )
      .join(' · ');
  return j.mensaje ?? j.message ?? `HTTP ${status}`;
}

export interface ListaSiigo<T> {
  pagination?: { page: number; page_size: number; total_results: number };
  results: T[];
}
