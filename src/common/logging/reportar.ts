import type { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * For failures outside an HTTP request (cron jobs, workers, fire-and-forget
 * notifications): the global exception filter never sees them, so they are
 * logged here with their stack and sent to the error tracker with the job
 * name, instead of only reaching the console.
 */
export function reportarFallo(
  logger: Logger,
  proceso: string,
  err: unknown,
  extra?: Record<string, unknown>,
) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error(`${proceso}: ${error.message}`, error.stack);
  Sentry.captureException(error, { tags: { proceso }, extra });
}
