# Despliegue en producción: backend en Contabo, frontend en Vercel

```
Navegador ──► Vercel (frontend, app.tudominio.com)
    │
    └──► Contabo VPS (api.tudominio.com)
            Caddy (HTTPS automático) ──► API NestJS ──► Redis (local)
                                              │   └──► Gotenberg (Word → PDF, local)
                                              └──► Supabase (Postgres, Auth, Storage)
```

La base de datos, el login y los archivos siguen en **Supabase**. En el VPS corren
cuatro contenedores: la **API**, **Redis** (límite de peticiones, caché de sesión y
la subasta en vivo entre instancias), **Gotenberg** (LibreOffice: convierte a PDF
los contratos y órdenes llenados desde las plantillas Word de cada empresa; ~1 GB
de RAM como máximo, sin puertos publicados) y **Caddy** (certificado TLS de Let's
Encrypt y proxy, incluidos los WebSockets de la subasta). Ya no hace falta Upstash.
Si Gotenberg no está, los documentos se entregan en Word en lugar de PDF.

Archivos: `Dockerfile`, `deploy/contabo/` (`docker-compose.yml`, `Caddyfile`,
`.env.example`, `preparar-servidor.sh`, `desplegar.sh`) y
`.github/workflows/deploy.yml`.

---

## 0. Antes de empezar

- Un VPS de Contabo con **Ubuntu 22.04 o 24.04** (el plan más pequeño sobra: la
  API usa ~300 MB de RAM). Entra por SSH como root con tu llave.
- Un dominio. Crea dos registros DNS:
  - `api.tudominio.com` → **A** → IP del VPS (sin proxy de Cloudflare al principio,
    para que Caddy pueda emitir el certificado).
  - `app.tudominio.com` → lo configuras en Vercel (paso 4).
- El proyecto de Supabase ya creado (ver `DESPLIEGUE-DEMO.md` § 1: buckets
  privados `homologacion-documentos`, `contratos-documentos`,
  `requerimientos-documentos`; `vitrina-proveedores`, `facturas-pagos` y `plantillas-documentos` los crea
  la API al arrancar).

## 1. Preparar el servidor (una sola vez, como root)

```bash
scp deploy/contabo/preparar-servidor.sh root@IP_DEL_VPS:/root/
ssh root@IP_DEL_VPS 'bash /root/preparar-servidor.sh https://github.com/<usuario>/bolt_procure_backend.git'
```

Instala Docker, activa el firewall (solo 22, 80 y 443), fail2ban, actualizaciones
de seguridad automáticas y 2 GB de swap; crea el usuario `procurex` (con tus
mismas llaves SSH) y clona el repositorio en `/opt/procurex`.

> Repositorio privado: antes de correr el script, crea en GitHub una
> *deploy key* de solo lectura, guárdala en el servidor (`/home/procurex/.ssh/`)
> y usa la URL `git@github.com:<usuario>/bolt_procure_backend.git`.

## 2. Configurar las variables

```bash
ssh procurex@IP_DEL_VPS
cd /opt/procurex/deploy/contabo
cp .env.example .env
nano .env
```

| Variable | Valor |
|---|---|
| `API_DOMAIN` | `api.tudominio.com` |
| `ACME_EMAIL` | tu correo (avisos del certificado) |
| `DATABASE_URL` | Supabase → Database → Connection string → **Session pooler** (5432) + `?connection_limit=10` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `CORS_ORIGIN` | URL(s) del frontend separadas por comas, sin `/` final: `https://app.tudominio.com,https://<proyecto>.vercel.app` |
| `APP_URL` | la URL pública del frontend (enlaces en correos) |
| `RESEND_API_KEY`, `EMAIL_FROM` | opcional: correos reales |
| `GLITCHTIP_DSN` | opcional: reporte de errores |

`REDIS_URL`, `PORT`, `NODE_ENV` y `TRUST_PROXY_HOPS` los fija el compose; no los
pongas en `.env`.

## 3. Desplegar

```bash
./desplegar.sh
```

Trae `main`, construye la imagen, arranca los contenedores (la API aplica las
migraciones de Prisma al iniciar) y espera a que `/health` responda. Al final
debe decir `✓ API saludable`. Compruébalo desde tu equipo:

```bash
curl https://api.tudominio.com/health
# {"status":"ok","db":"ok","redis":"ok",...}
```

Para actualizar después, el mismo comando: `./desplegar.sh`.

### Despliegue automático (opcional)

`.github/workflows/deploy.yml` corre `desplegar.sh` por SSH cada vez que el CI
de `main` pasa (y a mano desde *Actions*). Configura en GitHub → Settings →
Secrets and variables → Actions:

- `CONTABO_HOST`: IP del VPS
- `CONTABO_USER`: `procurex`
- `CONTABO_SSH_KEY`: una llave privada **nueva**, solo para esto (agrega la
  pública a `/home/procurex/.ssh/authorized_keys`)
- `CONTABO_PATH`: opcional (por defecto `/opt/procurex`)

Sin esos secretos el workflow no hace nada.

## 4. Frontend en Vercel

1. Vercel → *Add New Project* → importa `bolt_pro`. Framework: **Vite** (ya
   viene en `vercel.json`). Rama de producción: `main` (`develop` genera previsualizaciones).
2. *Environment Variables* (Production):

   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | `https://api.tudominio.com` |
   | `VITE_SUPABASE_URL` | la misma de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | la anon key |
   | `VITE_SITE_URL` | `https://app.tudominio.com` (canonical y sitemap) |
   | `VITE_MOSTRAR_CREDENCIALES_DEMO` | `false` en producción |
   | `VITE_GLITCHTIP_DSN` | opcional |

   Las `VITE_*` se incrustan al compilar: si cambias una, vuelve a desplegar.
3. *Settings → Domains*: agrega `app.tudominio.com` y crea el registro DNS que
   te indique Vercel.
4. Asegúrate de que ese dominio (y el `.vercel.app`) estén en `CORS_ORIGIN` del
   backend; si cambias `.env`, corre `./desplegar.sh` otra vez.

## 5. Supabase: URLs del frontend

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://app.tudominio.com`
- **Redirect URLs**: `https://app.tudominio.com/**` y
  `https://<proyecto>.vercel.app/**`

Sin esto, las invitaciones y el restablecimiento de contraseña redirigen mal.

## 6. Verificación final

- `https://api.tudominio.com/health` → `ok`.
- **Base de datos cerrada al navegador**: Supabase → Advisors → Security no
  debe mostrar "RLS disabled in public", y esta petición con la clave anónima
  debe devolver error o lista vacía, nunca usuarios (ver `docs/SEGURIDAD.md`):
  `curl "$SUPABASE_URL/rest/v1/users?select=email&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`
- Entra al frontend, inicia sesión y abre el Dashboard (si falla con error de
  red, revisa `CORS_ORIGIN` y `VITE_API_URL`).
- Abre una Negociación en dos navegadores: las pujas deben verse en vivo
  (WebSocket a través de Caddy).
- Sube un documento de homologación y una factura: prueban Supabase Storage.

## Operación diaria

```bash
cd /opt/procurex/deploy/contabo
docker compose ps                 # estado
docker compose logs -f api        # logs de la API
docker compose restart api        # reiniciar solo la API
docker compose exec redis redis-cli ping
```

- **Respaldo de la base**: sigue en `.github/workflows/backup.yml` (diario,
  cifrado) además de los respaldos de Supabase. Redis no guarda datos de negocio.
- **Volver a una versión anterior**: `git -C /opt/procurex checkout <commit>` y
  `docker compose up -d --build api`. Ojo: las migraciones ya aplicadas no se
  revierten solas.
- **Migraciones sin arrancar la API**: `RUN_MIGRATIONS=false` en `.env` y
  `docker compose run --rm --entrypoint ./node_modules/.bin/prisma api migrate deploy`.
- **Logs**: Docker los rota (20 MB × 5 para la API).

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| Caddy no obtiene certificado | El DNS de `api.` aún no apunta al VPS, el puerto 80 está cerrado o Cloudflare está en modo proxy. |
| `Config validation error` en los logs | Falta o está mal una variable de `.env` (el mensaje dice cuál). |
| `P1001 Can't reach database` | `DATABASE_URL` incorrecta, o se usó el pooler de transacciones (6543) en vez del de sesión (5432). |
| El frontend dice "Network Error" | `VITE_API_URL` mal escrita, o el dominio del frontend no está en `CORS_ORIGIN`. |
| Demasiadas conexiones a Postgres | Baja `connection_limit` en `DATABASE_URL`. |
