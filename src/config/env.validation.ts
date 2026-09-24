import * as Joi from 'joi';

/**
 * Fails the boot immediately with one clear error listing every problem,
 * instead of a missing/malformed var surfacing much later as a confusing
 * runtime failure (or, for vars with a `config.get(x, devDefault)` call
 * site, not surfacing at all — just silently running with a
 * localhost/dev-shaped value in production).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),
  // Number of reverse proxies in front of the API (1 on Render/Koyeb). 0 locally.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),

  DATABASE_URL: Joi.string().uri().required(),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  // One or more frontend URLs separated by commas; the first is the public one.
  CORS_ORIGIN: Joi.string()
    .custom((valor: string, helpers) => {
      const partes = valor
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const invalida = partes.find((o) => !/^https?:\/\/[^\s/]+(\/)?$/.test(o));
      return invalida || partes.length === 0
        ? helpers.error('any.invalid')
        : valor;
    })
    .default('http://localhost:5173'),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),

  // Optional integrations — genuinely fine to run without them locally.
  GLITCHTIP_DSN: Joi.string().uri().allow('').optional(),
  LOKI_HOST: Joi.string().uri().optional(),
  LOKI_USER: Joi.string().allow('').optional(),
  LOKI_PASSWORD: Joi.string().allow('').optional(),

  // Transactional email (Resend). Without the key, emails are only logged.
  RESEND_API_KEY: Joi.string().allow('').optional(),
  EMAIL_FROM: Joi.string().optional(),
  // Public URL of the frontend, used for links inside emails. Defaults to CORS_ORIGIN.
  APP_URL: Joi.string().uri().optional(),
}).unknown(true);
