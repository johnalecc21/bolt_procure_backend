# Seguridad: auditoría del backend y la base de datos

Revisión del 26 de septiembre de 2026 sobre el backend (NestJS + Prisma) y la base de datos (Postgres en Supabase). Cubre autenticación y autorización, aislamiento entre empresas, archivos, integraciones salientes y entrantes, cifrado, dependencias y la exposición de la base de datos.

## Corregido en esta revisión

| # | Severidad | Hallazgo | Corrección |
|---|---|---|---|
| 1 | **Crítica** | Las 44 tablas viven en el esquema `public` de Supabase **sin RLS**. Supabase publica ese esquema en su API REST (`/rest/v1`) y da permisos por defecto a los roles `anon` y `authenticated`; la clave anónima viaja en el frontend. Cualquiera podía leer y modificar todas las tablas (usuarios, ofertas, contratos, cuestionarios con cuentas bancarias…) sin pasar por el backend. | Migración `20260926090000_rls_y_permisos_supabase`: activa RLS en todas las tablas de `public` (sin políticas: `anon` y `authenticated` no ven nada) y revoca sus permisos sobre tablas, secuencias y funciones, también para tablas futuras. Prisma se conecta como dueño de las tablas, así que la aplicación no cambia. El frontend solo usa Supabase para autenticación. |
| 2 | Alta | `GET /proveedores/:id` devolvía a **cualquier usuario autenticado** (incluido un proveedor competidor) el cuestionario de homologación completo: cuenta bancaria, ingresos, patrimonio y representante legal, además del desglose del puntaje y las observaciones de compliance. | La ficha usa una lista cerrada de campos de la homologación: estado, puntaje, nivel de riesgo y fechas. El detalle sigue disponible solo en `/homologacion/mine` (el propio proveedor) y en la cola del equipo interno. |
| 3 | Alta | El rol está en el usuario, no en la membresía. El admin de una empresa podía **invitar a un usuario que ya pertenecía a otra empresa** (bastaba el correo) y luego cambiarle el rol, con efecto también en la otra empresa (ascenderlo a administrador o quitarle permisos). También podía sumar cuentas de proveedor o del equipo Procurex a su empresa. | La invitación rechaza correos de otras empresas y de cuentas que no son del portal cliente. El cambio de rol se rechaza si el usuario también pertenece a otra empresa; ese caso lo gestiona el equipo de Procurex. |
| 4 | Baja | Las confirmaciones de subida validan que la ruta empiece por la carpeta de la empresa o del proveedor, pero una ruta con `..` podría salirse de ese prefijo. | `StorageService` rechaza rutas con segmentos `..` o `.` y rutas que empiezan por `/` en todas sus operaciones. |

Prueba: `e2e-seguridad` cubre los casos 2, 3 y 4. La migración se probó creando los roles `anon` y `authenticated` en Postgres local: después de aplicarla, `anon` recibe `permission denied` y el backend sigue leyendo y escribiendo.

**Después de desplegar:** en Supabase → Advisors → Security, el aviso "RLS disabled in public" debe desaparecer. Como prueba rápida, esta petición con la clave anónima debe devolver un error o una lista vacía, nunca usuarios:
`curl "$SUPABASE_URL/rest/v1/users?select=email&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`

## Lo que está bien

- **Autenticación.** Un guard global valida cada token contra Supabase Auth y carga el perfil desde la base de datos; el rol nunca sale de los metadatos del token. Los usuarios inactivos o sin empresa quedan fuera. `x-company-id` solo acepta empresas donde el usuario tiene membresía activa.
- **Autorización.** Guards globales de rol. Las rutas sin `@Roles` filtran por `companyId` o por el proveedor del usuario dentro del servicio, y lo hacen de forma consistente: requerimientos, ofertas, contratos, pagos, preguntas, aprobaciones y documentos.
- **Ofertas.** Solo un proveedor invitado ofertará, solo con la licitación abierta; el total lo calcula el servidor a partir de las líneas.
- **Archivos.** Buckets privados, subida y descarga con URLs firmadas de corta duración, prefijo de ruta validado en cada confirmación y límite de 10 MB.
- **Webhooks del ERP (SSRF).** Solo HTTPS, sin credenciales en la URL, IPs privadas bloqueadas (incluidas las IPv4 mapeadas en IPv6), revalidación en cada envío, sin seguir redirecciones y con un límite de tiempo. Firma HMAC con marca de tiempo.
- **API de entrada del ERP.** Las API keys se guardan como hash, con prefijo visible para identificarlas.
- **Secretos de integraciones** (webhook, Siigo) cifrados con AES-256-GCM.
- **Plantillas docx.** El parser solo resuelve rutas con puntos; no evalúa expresiones.
- **Transporte y cabeceras.** Helmet, CORS con lista de orígenes, `trust proxy` limitado a los saltos configurados y límite de peticiones global (120/min por IP, con Redis). El registro de proveedores tiene un límite de 5 cada 10 minutos. Swagger está apagado en producción.
- **Validación.** `ValidationPipe` global con `whitelist`: los campos no declarados en los DTO se descartan.
- **Errores.** Los 5xx no exponen la traza; se registran con el ID de petición.
- **SQL.** Solo hay dos consultas crudas, ambas parametrizadas (`$queryRaw` con plantilla).
- **WebSocket de subasta.** Autentica con el token de Supabase en el handshake y verifica el acceso a cada sala.

## Pendiente (recomendado, no bloqueante)

| Severidad | Tema | Recomendación |
|---|---|---|
| Media | **Rol por usuario y no por membresía.** Con la corrección 3 ya no se puede abusar, pero un usuario compartido entre empresas tiene el mismo rol en todas. | Mover `role` a `CompanyMembership` cuando haga falta que alguien sea, por ejemplo, admin en una empresa y comprador en otra. |
| Media | **DNS rebinding en el webhook.** La URL se valida y luego `fetch` vuelve a resolver el dominio; un dominio malicioso podría cambiar de IP entre los dos pasos. Mitigado porque no se siguen redirecciones y la respuesta se recorta a 300 caracteres. | Conectar a la IP ya validada (un agente HTTP con `lookup` fijo) conservando el nombre para TLS/SNI. |
| Media | **Conexión a la base de datos como `postgres`.** El backend usa el superusuario del proyecto. | Crear un rol propio para la aplicación (dueño de las tablas, sin `SUPERUSER` ni `BYPASSRLS` global) y usar `sslmode=require` en `DATABASE_URL`. |
| Media | **Datos sensibles en claro dentro de la base.** La cuenta bancaria y las cifras financieras del cuestionario se guardan en JSON sin cifrar (el disco de Supabase sí está cifrado). | Cifrar `cuentaBancaria` con la misma clave de integraciones, o guardarla aparte. |
| Baja | **Carrera en aprobaciones.** `aprobar` comprueba el estado `PENDIENTE` y luego actualiza; dos clics simultáneos podrían registrar el paso dos veces. | Actualizar con `where: { id, estado: 'PENDIENTE' }` y verificar el conteo dentro de la transacción. |
| Baja | **Cuota de almacenamiento.** El tamaño que cuenta para la cuota lo informa el navegador. | Leer el tamaño real del objeto en Storage al confirmar. |
| Baja | **Clave de cifrado de integraciones.** Si falta `INTEGRACIONES_SECRET`, se deriva de la service role key de Supabase: rotar esa clave dejaría ilegibles los secretos guardados. | Definir `INTEGRACIONES_SECRET` propia en producción. |
| Baja | **Contador de vistas de la vitrina.** Es público y sin deduplicar, así que se puede inflar. | Deduplicar por IP y día si llega a usarse para algo más que informar. |
| Baja | **Dependencias.** `npm audit` muestra 3 avisos altos, todos en el CLI y la configuración de Prisma (`deepmerge-ts`); no se usan en tiempo de ejecución con datos externos. | Actualizar Prisma en la próxima versión mayor. |
| Info | **Ofertas visibles antes del cierre.** El comprador ve los precios mientras la licitación sigue abierta. | Si se quiere un sobre cerrado, ocultar los montos hasta la fecha límite. Es una decisión de negocio. |
| Info | **Registro abierto en Supabase Auth.** Alguien puede crear un usuario de Auth con la clave anónima; no obtiene nada porque sin perfil en la base el backend lo rechaza. | Desactivar "Allow new users to sign up" si todo el registro pasa por el backend y las invitaciones. |
