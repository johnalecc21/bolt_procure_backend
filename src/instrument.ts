// Must be imported before anything else in main.ts — Sentry's NestJS
// instrumentation patches modules as they're required, so this has to run
// before NestFactory (or anything it pulls in) is ever imported.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

// GLITCHTIP_DSN unset (e.g. local dev without a configured project) means
// Sentry.init just no-ops — nothing is sent anywhere, no errors thrown.
Sentry.init({
  dsn: process.env.GLITCHTIP_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.2,
});
