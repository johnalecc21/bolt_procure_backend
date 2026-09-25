import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Only a plain token from the client is reused (the frontend sends a UUID);
// anything else is replaced so a caller can't inject text into the logs.
const VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/**
 * One id per request, shared by the frontend (which generates it and shows
 * it in error messages), every log line of the request, the error body and
 * the error tracker — so a user's "ref. 3f2a…" leads straight to the logs.
 */
export function generarRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const recibido = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof recibido === 'string' && VALIDO.test(recibido)
      ? recibido
      : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
