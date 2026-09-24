# Despliegue de demostración (gratis, sin dominio propio)

Deja la plataforma en internet para mostrarla, sin costo. **No es un
despliegue de producción**: los servicios gratuitos se duermen y tienen
límites (ver al final). Tiempo estimado: 30–45 minutos.

| Pieza | Servicio | URL que obtienes |
|---|---|---|
| Frontend | Vercel (Hobby) | `https://<nombre>.vercel.app` |
| Backend | Render (Free) | `https://procurex-api.onrender.com` |
| Base de datos, login y archivos | Supabase (Free) | la que ya usas |
| Redis | Upstash (Free) | `rediss://…upstash.io:6379` |

Correos (Resend), Grafana/Loki y GlitchTip quedan **apagados**: el backend
funciona sin sus variables.

---

## 1. Supabase

1. En tu proyecto: **Project Settings → API** → copia `Project URL`,
   `anon public` y `service_role` (esta última es secreta).
2. **Project Settings → Database → Connection string → Session pooler**
   (puerto **5432**) → copia la URI y reemplaza `[YOUR-PASSWORD]`.
   No uses la conexión directa: es solo IPv6 y Render no la alcanza. Tampoco
   el *Transaction pooler* (6543): Prisma Migrate no funciona con él.
   Agrega al final de la URI `?connection_limit=5&pool_timeout=20`: el
   pooler de sesión del plan gratis admite pocas conexiones y Prisma, por
   defecto, abre una por núcleo × 2 + 1; así el backend no las agota.
3. **Storage**: si es un proyecto nuevo, crea como **privados** los buckets
   `homologacion-documentos`, `contratos-documentos` y
   `requerimientos-documentos` (los de `vitrina-proveedores` y `facturas-pagos`
   los crea el backend al arrancar).

## 2. Upstash (Redis)

1. upstash.com → **Create Database** (Redis), región cercana a la de Render.
2. Copia la URL que empieza por **`rediss://`** (con TLS).

## 3. Render (backend)

1. render.com → **New → Blueprint** → conecta GitHub y elige el repositorio
   del backend. Render lee `render.yaml` (rama `main`).
2. Completa las variables que pide:
   - `DATABASE_URL` → la del paso 1.2
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → paso 1.1
   - `REDIS_URL` → paso 2.2
   - `CORS_ORIGIN` y `APP_URL` → por ahora `https://example.com`; se
     corrigen en el paso 5.
3. Espera el deploy (5–10 min la primera vez). Al arrancar aplica las
   migraciones. Comprueba `https://<tu-servicio>.onrender.com/health` →
   `{"status":"ok","db":"ok","redis":"ok"}`.

## 4. Vercel (frontend)

1. vercel.com → **Add New → Project** → importa el repositorio del frontend.
2. Framework: **Vite** (se detecta solo). Build: `npm run build`, salida `dist`.
3. **Importante:** la rama `main` de ese repositorio está vacía; el código
   está en `integration`. Después de importar: **Settings → Git → Production
   Branch** = `integration`, y vuelve a desplegar.
4. Variables de entorno:
   - `VITE_API_URL` = `https://<tu-servicio>.onrender.com`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = las del paso 1.1
   - `VITE_MOSTRAR_CREDENCIALES_DEMO` = `true` si quieres que los logins muestren los usuarios demo (solo para demos; en un despliegue real déjalo sin definir)
     (nunca la `service_role` en el frontend).
5. Despliega y copia la URL `https://<nombre>.vercel.app`.

`vercel.json` ya hace que las rutas internas (`/cliente/...`,
`/vitrina/:id`) no den 404 al recargar.

## 5. Conectar todo

1. **Render → Environment**: `CORS_ORIGIN` y `APP_URL` = la URL de Vercel,
   sin `/` al final. Guarda (Render redespliega solo).
2. **Supabase → Authentication → URL Configuration**:
   - *Site URL* = la URL de Vercel
   - *Redirect URLs* = `https://<nombre>.vercel.app/**`

   Sin esto, las invitaciones y el login con Google redirigen a `localhost`.

## 6. Datos de demostración (opcional)

Desde tu computador, con el `.env` apuntando a Supabase (misma
`DATABASE_URL` del paso 1.2 y las llaves de Supabase):

```bash
npm run seed
```

Crea las empresas y los usuarios demo (contraseña `demo123`, ver README).
Son credenciales públicas: úsalas solo en el entorno de demostración.

## Antes de cada demo

- **Despierta el backend** 1–2 minutos antes: abre
  `https://<tu-servicio>.onrender.com/health`. En el plan gratis se duerme
  tras 15 minutos sin uso y tarda ~1 minuto en arrancar.
- Si no usaste Supabase en 7 días, el proyecto está **pausado**: reactívalo
  desde el panel (tarda unos minutos).

## Límites del plan gratis

- Render: 512 MB de RAM, 750 h/mes, se duerme por inactividad.
- Upstash: 500.000 comandos/mes. Suficiente para demos; con uso diario
  real se agota.
- Supabase: 500 MB de base de datos, 1 GB de archivos, pausa tras 7 días
  sin actividad.
- Sin correos (Resend) ni alertas: las notificaciones solo se ven dentro de
  la app.

Para producción real (clientes pagando), ver `docs/OPERACION.md`: planes
pagos sin suspensión, respaldos, alertas y dominio propio.
