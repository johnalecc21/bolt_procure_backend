# Logs y errores: cómo encontrar qué falló

Tres piezas, unidas por un mismo **ID de petición**:

| Dónde | Qué guarda | Variable |
|---|---|---|
| **Loki / Grafana** (logs del backend) | Una línea por petición: método, ruta, estado, duración, usuario, empresa, portal, rol, ID de petición y el motivo del error. Más los errores de los procesos programados. | `LOKI_HOST`, `LOKI_USER`, `LOKI_PASSWORD` |
| **GlitchTip** (errores del backend) | Errores inesperados (5xx) y fallas de procesos en segundo plano, con traza, usuario, empresa, portal, rol, ruta, ID de petición y versión desplegada. | `GLITCHTIP_DSN`, `GIT_SHA` |
| **GlitchTip** (errores del frontend) | Pantallas que se rompen, respuestas 5xx, fallas de conexión y respuestas del backend con forma inesperada, con usuario, empresa, portal, rol, ID de petición y versión. | `VITE_GLITCHTIP_DSN`, `VITE_APP_VERSION` |

Sin estas variables no se envía nada a ningún lado: los logs solo salen por consola.

## El ID de petición

1. El frontend genera un ID por cada llamada y lo envía en `X-Request-Id`.
2. El backend lo reutiliza (o crea uno si no llega o no es válido), lo pone en cada línea de log de esa petición, lo devuelve en el encabezado `X-Request-Id` y en el cuerpo de error (`requestId`), y lo etiqueta en GlitchTip (`requestId`).
3. Si algo falla de forma inesperada, el usuario ve el mensaje con una referencia corta, por ejemplo: *Ha ocurrido un error interno. Intenta nuevamente. (ref. 3f2a9c1b)*. Si la pantalla completa se rompe, ve *"Si escribes a soporte, menciona el código …"* (el ID del evento en GlitchTip).

Los errores esperados (validaciones, permisos, conflictos: 4xx) muestran su mensaje sin referencia y no se reportan a GlitchTip, pero quedan en el log con su motivo.

## Paso a paso cuando un usuario reporta un error

**Con una referencia (ref. xxxxxxxx):**
- Loki (Grafana → Explore): `{app="bolt-procure-backend"} |= "3f2a9c1b"` muestra la línea de la petición: quién, qué empresa, ruta, estado y motivo; en un 5xx, la traza completa.
- GlitchTip → Issues, buscar `requestId:3f2a9c1b…` (el ID completo aparece en la línea de Loki) para ver el error del backend y el del frontend de esa misma petición.

**Con un código de pantalla:** GlitchTip (proyecto del frontend) → buscar el ID del evento. Trae la ruta, el componente que falló, el usuario, la empresa y la versión del frontend.

**Sin referencia:** filtrar en Loki por la persona o la empresa, por ejemplo `{app="bolt-procure-backend"} | json | userEmail="ana@acme.co"` o `companyId="…"`, y por nivel: `level >= 40` (advertencias 4xx) o `level >= 50` (errores).

## Niveles en el log del backend

| Nivel | Cuándo |
|---|---|
| `info` (30) | Petición exitosa, eventos normales de los procesos programados |
| `warn` (40) | Respuesta 4xx, con el motivo (por ejemplo, `POST /ofertas 400 — La licitación ya cerró`) |
| `error` (50) | Respuesta 5xx con su traza; falla de un proceso programado o en segundo plano; error de la base de datos |

Las consultas de salud (`/health`) no se registran, para no tapar el tráfico real. El token, las cookies y los `set-cookie` se eliminan de los logs.

## Fallas fuera de una petición

Estos procesos registran el error con su traza **y** lo envían a GlitchTip con la etiqueta `proceso`:

- vencimientos diarios, monitoreo de riesgo, retención de auditoría;
- envío de eventos al ERP y encolado de eventos, pagos leídos desde Siigo;
- publicación de procesos en la red, cierre automático de subastas;
- envío de correos (tras agotar los reintentos), documentos desde plantilla;
- descarga de las listas OFAC/SDN y ONU (el cribado sigue con la última copia, pero hay que saberlo).

## Versión desplegada

- Backend: `GIT_SHA` (o `RENDER_GIT_COMMIT` si el hosting la expone) llega a GlitchTip como *release*.
- Frontend: `VITE_APP_VERSION` se llena sola al compilar con el commit (`VERCEL_GIT_COMMIT_SHA` en Vercel o `git rev-parse` local).

## Pendiente

- **Mapas de código del frontend (source maps):** hoy la traza de un error del frontend apunta al código minificado. Para ver el archivo y la línea reales hay que subir los source maps de cada versión a GlitchTip con `sentry-cli` en el pipeline de despliegue (requiere un token de GlitchTip).
- Las alertas de Grafana (ver `OPERACION.md`) necesitan un punto de contacto configurado.
