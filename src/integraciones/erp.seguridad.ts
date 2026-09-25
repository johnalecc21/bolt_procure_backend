import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 32-byte key from the configured secret (never stored). */
export function claveCifrado(secreto: string): Buffer {
  return createHash('sha256').update(`procurex-erp:${secreto}`).digest();
}

/** AES-256-GCM: iv.tag.ciphertext, base64url. */
export function cifrar(texto: string, clave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos]
    .map((b) => b.toString('base64url'))
    .join('.');
}

export function descifrar(cifrado: string, clave: Buffer): string {
  const [iv, tag, datos] = cifrado
    .split('.')
    .map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', clave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

export const hashApiKey = (key: string) =>
  createHash('sha256').update(key).digest('hex');

export function nuevoSecreto(prefijo: string) {
  return `${prefijo}_${randomBytes(24).toString('base64url')}`;
}

/**
 * Signature the receiver checks: HMAC-SHA256 over "timestamp.body" with the
 * shared secret. Including the timestamp lets receivers reject replays.
 */
export function firmar(secreto: string, timestamp: string, cuerpo: string) {
  return `sha256=${createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex')}`;
}

export function firmaValida(
  secreto: string,
  timestamp: string,
  cuerpo: string,
  firma: string,
) {
  const esperada = Buffer.from(firmar(secreto, timestamp, cuerpo));
  const recibida = Buffer.from(firma);
  return (
    esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
  );
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function ipPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return ipPrivada(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * The webhook URL is chosen by a customer, and our server calls it — so it
 * must not be usable to reach our own network (Redis, metadata endpoints…).
 * HTTPS only, and every address the name resolves to must be public.
 * `permitirLocal` exists for local development and tests.
 */
export async function validarUrlWebhook(
  url: string,
  permitirLocal = false,
  resolver: (host: string) => Promise<string[]> = async (h) =>
    (await lookup(h, { all: true })).map((r) => r.address),
): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'La URL no es válida.';
  }
  const local =
    permitirLocal && ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return 'La URL debe usar HTTPS.';
  if (u.username || u.password)
    return 'La URL no puede llevar usuario ni contraseña.';
  if (local) return null;
  let ips: string[];
  try {
    ips = isIP(u.hostname) ? [u.hostname] : await resolver(u.hostname);
  } catch {
    return 'No se pudo resolver el dominio de la URL.';
  }
  if (ips.length === 0 || ips.some(ipPrivada))
    return 'La URL apunta a una red privada; usa una dirección pública.';
  return null;
}
