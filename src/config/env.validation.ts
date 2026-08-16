import * as Joi from 'joi';

/**
 * Fails the boot immediately with one clear error listing every problem,
 * instead of a missing/malformed var surfacing much later as a confusing
 * runtime failure (or, for vars with a `config.get(x, devDefault)` call
 * site, not surfacing at all — just silently running with a
 * localhost/dev-shaped value in production).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3001),

  DATABASE_URL: Joi.string().uri().required(),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).default('redis://localhost:6379'),

  // Optional integrations — genuinely fine to run without them locally.
  GLITCHTIP_DSN: Joi.string().uri().allow('').optional(),
  LOKI_HOST: Joi.string().uri().optional(),
  LOKI_USER: Joi.string().allow('').optional(),
  LOKI_PASSWORD: Joi.string().allow('').optional(),
}).unknown(true);
