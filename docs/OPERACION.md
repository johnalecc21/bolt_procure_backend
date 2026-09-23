# Operación: respaldos, monitoreo y disponibilidad

Este documento es la guía para operar Procurex en producción. Cada sección dice
qué está automatizado en el repositorio y qué hay que configurar a mano.

## 1. Compromiso de disponibilidad (propuesta de SLA)

| Plan | Disponibilidad mensual | Tiempo de caída máximo al mes | Soporte |
|---|---|---|---|
| Starter | 99,5 % | ~3 h 40 min | Correo, respuesta en 1 día hábil |
| Growth | 99,5 % | ~3 h 40 min | Correo y chat, 4 h hábiles |
| Enterprise | 99,9 % | ~44 min | Canal dedicado, 1 h para incidentes críticos |

Se mide con el monitor externo de `/health` (sección 4). No cuentan las
ventanas de mantenimiento avisadas con 48 h de anticipación. Para ofrecer
99,9 % hace falta al menos: dos instancias del backend detrás de un balanceador,
Redis administrado y Supabase en plan Pro o superior.

**Objetivos de recuperación**

| | Con respaldo diario (incluido) | Con PITR de Supabase (add-on) |
|---|---|---|
| RPO — datos que se pueden perder | hasta 24 h | ~2 min |
| RTO — tiempo para volver a operar | 4 h | 1 h |

## 2. Respaldos

Hay tres capas; las dos primeras son obligatorias en producción.

1. **Supabase (nivel plataforma).** Plan Pro o superior: respaldos diarios
   automáticos con 7 días de retención. Para RPO de minutos, activar
   *Point-in-Time Recovery* en Project Settings → Add-ons.
2. **Respaldo lógico propio, fuera de Supabase.** El workflow
   `.github/workflows/backup.yml` corre `scripts/backup-db.sh` todos los días,
   cifra el archivo con GPG y lo guarda 30 días como artefacto privado. Así
   hay una copia aunque se pierda el acceso al proyecto de Supabase.
   Configurar los secretos `BACKUP_DATABASE_URL` y `BACKUP_PASSPHRASE`.
   La frase de cifrado debe guardarse también en un gestor de contraseñas
   del equipo: sin ella el respaldo no sirve.
3. **Archivos (Storage).** Los respaldos de base de datos **no** incluyen los
   archivos subidos (buckets `homologacion-documentos`, `contratos-documentos`,
   `requerimientos-documentos`, `vitrina-proveedores`). Copiarlos a un bucket
   externo (S3, GCS o R2) con `rclone sync` contra el endpoint S3 de Supabase
   Storage, al menos semanalmente.

### Simulacro de restauración (mensual)

Un respaldo que nunca se ha restaurado no es un respaldo.

```bash
# 1. Descarga el último artefacto del workflow "Respaldo diario" (Actions).
# 2. Crea una base vacía de prueba (local o un proyecto Supabase de pruebas).
createdb procurex_drill
# 3. Restaura y verifica:
RESTORE_DATABASE_URL=postgresql://localhost/procurex_drill \
SOURCE_DATABASE_URL="<solo lectura a producción, opcional>" \
BACKUP_PASSPHRASE="<frase>" \
./scripts/restore-drill.sh procurex-AAAAMMDD-HHMMSS.dump.gpg
```

El script compara los conteos de las tablas clave con el origen y reporta
cuánto tardó (el RTO real de la base). Registrar el resultado en la bitácora
de operación: fecha, archivo usado, duración, responsable.

### Restauración real (incidente)

1. Declarar el incidente y poner la app en mantenimiento.
2. Preferir la restauración de Supabase (PITR o respaldo diario) desde el panel.
3. Si no está disponible: crear un proyecto nuevo, restaurar el último
   respaldo propio con `restore-drill.sh` (exportando `PERMITIR_SUPABASE=1`),
   aplicar `npx prisma migrate deploy` y cambiar `DATABASE_URL`.
4. Restaurar los archivos desde la copia externa del Storage.
5. Verificar `/health`, iniciar sesión en los tres portales y abrir un
   requerimiento y un contrato.

## 3. Alertas

- **Errores de aplicación:** GlitchTip (`GLITCHTIP_DSN`). En GlitchTip →
  Project → Alerts, crear una alerta por correo cuando aparezca un error
  nuevo y otra cuando un error supere 20 eventos por hora.
- **Logs y métricas:** `grafana/provisioning/alerting/reglas-backend.yml`
  crea cuatro reglas sobre los logs de Loki:
  - más de 10 errores en 5 minutos (severidad alta),
  - más de 5 respuestas 5xx en 5 minutos (alta),
  - latencia p95 mayor a 2 s durante 10 minutos (media),
  - 10 minutos sin logs del backend (crítica — probablemente caído).

  Falta definir a quién avisar: en Grafana → Alerting → Contact points, crear
  un punto de contacto (correo o Slack) y en Notification policies asignarlo
  a la política por defecto. Las reglas no se probaron contra un Grafana en
  ejecución; verificar en Alerting → Alert rules que aparezcan sin errores
  después del primer despliegue.

## 4. Monitoreo externo

Configurar un monitor (UptimeRobot, Better Stack o similar) contra
`GET https://<api>/health` cada minuto. Responde 200 si la base de datos y
Redis contestan y 503 si alguno falla. Es la fuente para medir el SLA y debe
avisar por SMS o llamada, no solo por correo. Publicar una página de estado
para los clientes Enterprise.

## 5. Tareas programadas

| Tarea | Horario | Qué hace |
|---|---|---|
| Vencimientos de contratos | 06:00 diario | Marca contratos por vencer/vencidos y avisa a 60/30/15 días |
| Retención de auditoría | 03:00 diario | Borra registros más viejos que la retención de cada empresa (por defecto 120 meses) |
| Respaldo lógico | 02:30 hora Colombia | Workflow de GitHub Actions |

Las dos primeras usan un bloqueo en Redis: con varias instancias solo una las ejecuta.

## 6. Límites por plan

Definidos en `src/planes/planes.constants.ts`:

| | Starter | Growth | Enterprise |
|---|---|---|---|
| Usuarios activos | 5 | 25 | Ilimitado |
| Requerimientos por mes | 15 | 150 | Ilimitado |
| Almacenamiento (adjuntos de requerimientos y contratos) | 1 GB | 10 GB | Ilimitado |

El uso se consulta en `GET /empresa/uso`. El tamaño de cada archivo lo reporta
el navegador al subirlo; los buckets de Supabase limitan cada archivo a 10 MB.

## 7. Correos transaccionales

Cada notificación de la plataforma también se envía por correo (salvo que el
usuario lo desactive en Configuración). Proveedor: Resend.

1. Crear la cuenta en resend.com y verificar el dominio de envío (registros
   SPF, DKIM y DMARC en el DNS).
2. Definir `RESEND_API_KEY`, `EMAIL_FROM` (ej. `Procurex <notificaciones@procurex.co>`)
   y `APP_URL` (URL pública del frontend).
3. Sin `RESEND_API_KEY` los correos solo se registran en el log — útil en
   desarrollo.

Un correo que falla se reintenta 3 veces y luego se registra como error; nunca
bloquea la acción que lo originó. Para volúmenes altos, mover el envío a una
cola de trabajos.
