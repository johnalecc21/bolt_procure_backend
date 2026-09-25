# ProcureOS Backend

API real (NestJS + Prisma + PostgreSQL) para la plataforma ProcureOS. Vive como proyecto hermano del frontend (`bolt_procure`), no dentro de él.

## Ramas

`main` = producción (lo que despliega `desplegar.sh` y el workflow de Contabo), `develop` = integración del trabajo en curso.

## Despliegue

- **Producción (Contabo + Vercel):** [`docs/DESPLIEGUE-CONTABO.md`](docs/DESPLIEGUE-CONTABO.md)
- **Integración con ERP** (archivo o webhook firmado): [`docs/INTEGRACION-ERP.md`](docs/INTEGRACION-ERP.md)
- **Plantillas de contratos y órdenes de compra** de cada empresa: [`docs/PLANTILLAS-DOCUMENTOS.md`](docs/PLANTILLAS-DOCUMENTOS.md)
- **Red de proveedores, tablero en vivo y riesgo continuo**: [`docs/RED-Y-RIESGO.md`](docs/RED-Y-RIESGO.md)
- Demo gratis (Render + Vercel): [`docs/DESPLIEGUE-DEMO.md`](docs/DESPLIEGUE-DEMO.md)

## Stack

- **NestJS 11** (TypeScript)
- **PostgreSQL** vía Prisma ORM
- **JWT** (auth con 2FA simulado y selector de multi-empresa)
- **Socket.IO** (`@nestjs/websockets`) para la subasta/negociación en vivo
- **Swagger** en `/docs`

## Requisitos

- Node.js 20+
- Docker Desktop (para levantar Postgres local) **o** una instancia de Postgres propia

## Puesta en marcha

```bash
# 1. Instalar dependencias (ya hecho si acabas de clonar)
npm install

# 2. Copiar variables de entorno
cp .env.example .env

# 3. Levantar Postgres local (requiere Docker Desktop corriendo)
docker compose up -d

# 4. Generar el cliente de Prisma y crear las tablas
npm run prisma:generate
npm run prisma:migrate -- --name init

# 5. Cargar datos de demo (mismos usuarios/empresas que el frontend)
npm run seed

# 6. Levantar el servidor
npm run start:dev
```

La API queda en `http://localhost:3001`, con documentación interactiva en `http://localhost:3001/docs`.

## Usuarios demo (contraseña `demo123` para todos)

| Portal | Email | Rol |
|---|---|---|
| Cliente | `carlos@acme.com` | Comprador |
| Cliente | `laura@acme.com` | Comprador |
| Cliente | `ana.cfo@acme.com` | Aprobador/CFO (2FA) |
| Cliente | `admin@acme.com` | Admin Cliente (2FA, 2 empresas: Acme y TechCorp) |
| Proveedor | `contacto@cloudsphere.com` | Proveedor |
| Interno | `ana.consultora@procureos.com` | Consultor |
| Interno | `compliance@procureos.com` | Compliance/Ops |

Código de 2FA de demo: `000000`.

## Estructura

Cada dominio del spec funcional tiene su propio módulo NestJS bajo `src/`:

```
auth/            login, 2FA, selector de empresa, registro de proveedor
usuarios/        gestión de usuarios y roles (Admin Cliente)
requerimientos/  ciclo de vida del requerimiento
aprobaciones/    bandeja de aprobaciones
matriz-aprobacion/  reglas de aprobación por monto
proveedores/     directorio de proveedores
homologacion/    formulario + cola de revisión (compliance), listas restrictivas, requisitos por empresa
ofertas/         carga de oferta estructurada / comparativo
adjudicacion/    confirmación, revisión legal, firma electrónica simulada
contratos/       repositorio de contratos/POs
seguimiento/     hitos post-PO
evaluaciones/    evaluación de desempeño del proveedor por contrato
estructura/      sedes / unidades de negocio, centros de costo y presupuestos anuales
planes/          límites por plan (usuarios, requerimientos/mes, almacenamiento) y /empresa/uso
email/           correos transaccionales (Resend) de cada notificación
vitrina/         vitrina pública y contenido del proveedor
invitaciones/    bandeja de invitaciones del proveedor
pagos/           centro de pagos / pronto pago
notificaciones/  centro de notificaciones
audit-log/       registro de auditoría transversal
subasta/         WebSocket gateway para negociación/subasta en vivo
interno/         empresas clientes: resumen agregado por empresa y alta de nuevas
```

## Homologación

- Cada proveedor completa el cuestionario y carga sus documentos **una sola vez**, y sirven para todos los clientes. Los 9 documentos de la sección 7 del cuestionario son obligatorios para enviar; HSE, sostenibilidad, centrales de riesgo y SARLAFT/LAFT son opcionales (suman puntaje a compliance/financiero en el score ponderado).
- **Listas restrictivas**: al enviar se cruza la razón social y el representante legal contra OFAC/SDN y la lista consolidada del Consejo de Seguridad de la ONU. Si una lista no responde queda `NO_DISPONIBLE` y la homologación pasa a zona gris (nunca se asume "limpio"). Para proveedores colombianos se agregan Procuraduría, Contraloría y Policía como `PENDIENTE_MANUAL` (no tienen API pública); Compliance registra el resultado con `POST /homologacion/:proveedorId/verificaciones` y no puede aprobar mientras haya listas pendientes, caídas o con coincidencias sin resolver.
- **Requisitos por empresa**: el Admin Cliente define en `PUT /homologacion/requisitos` qué categorías exige (validadas y vigentes) para poder invitar a un proveedor. Vacío = basta con homologación aprobada.
- **Vitrina pública**: `GET /vitrina/:id` (sin login) muestra el perfil verificado de un proveedor homologado junto con el contenido que él mismo administra desde `/vitrina/mine`: presentación, contacto, video, galería de imágenes (hasta 20), brochures y catálogos en PDF (hasta 5 de cada uno) y catálogo de productos/servicios con foto y precio de referencia (hasta 60). Los archivos van al bucket privado `vitrina-proveedores` (el backend lo crea al arrancar si no existe; máx. 10 MB por archivo) y se sirven con URLs firmadas. El directorio de clientes también busca por la descripción y los productos del catálogo.

## Estructura interna y presupuestos

Cada empresa cliente puede definir **sedes / unidades de negocio** y **centros de costo** con **presupuesto anual** (`/estructura`). Los requerimientos se cargan a un centro de costo (obligatorio si la empresa activa `exigeCentroCosto`) y los contratos lo heredan. Si un requerimiento supera lo disponible (presupuesto − contratos del año − requerimientos en curso, en la misma moneda), igual va a aprobación pero como **excepción de presupuesto** y con el CFO en la cadena. `GET /estructura/ejecucion?anio=` da la ejecución por centro.

## Auditoría

La bitácora se exporta en CSV (`GET /audit-log/export?desde=&hasta=`, Admin/CFO) y cada empresa define cuántos meses se guarda (`/audit-log/retencion`, por defecto 120; un proceso diario borra lo más viejo).

## Operación

Respaldos, simulacro de restauración, alertas, SLA y límites por plan: ver [`docs/OPERACION.md`](docs/OPERACION.md).

Despliegue de demostración gratis (Vercel + Render + Supabase + Upstash): ver [`docs/DESPLIEGUE-DEMO.md`](docs/DESPLIEGUE-DEMO.md).

## Moneda

Cada empresa tiene `pais` y `monedaBase` (COP, USD, MXN, PEN, CLP, BRL). Los requerimientos toman esa moneda (o una explícita) y la heredan contratos, POs y pagos. Los montos son enteros en unidades completas. La analítica solo agrega montos en la moneda base (no hay fuente de tasas de cambio).

## RBAC

Los guards globales (`JwtAuthGuard`, `PortalGuard`, `RolesGuard`) leen los decoradores `@Public()`, `@PortalOnly()`, `@Roles()` y `@ReadonlyRoles()` en cada controlador/endpoint, replicando la matriz de permisos del frontend.

## Subasta en vivo (WebSocket)

Namespace `/subasta`. El cliente se conecta pasando el JWT en `socket.handshake.auth.token` y emite:

- `join` `{ requerimientoId }`
- `iniciar` `{ requerimientoId, durationMs, seed }` (comprador)
- `pujar` `{ requerimientoId, monto }` (proveedor)
- `cerrar` `{ requerimientoId }` (comprador)

El servidor difunde el evento `state` a todos los conectados a esa sala cada vez que cambia.

## Notas

- El frontend (`bolt_pro`, ramas `main`/`develop`) ya está conectado a esta API vía `src/lib/api/*.ts` (auth, requerimientos, ofertas, adjudicación, contratos, homologación, subasta en vivo, etc.). Los stores mock correspondientes fueron eliminados del frontend.
- El log de auditoría, notificaciones y homologación usan datos reales persistidos en Postgres.
- Pantallas sin modelo de datos propio (Analítica CFO, Auditoría de Ahorro, Asistente de Redacción RFP, Onboarding ERP) siguen simuladas en el frontend a propósito — conectarlas requeriría diseñar nuevas entidades, no solo cablear lo existente.
