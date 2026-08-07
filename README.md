# ProcureOS Backend

API real (NestJS + Prisma + PostgreSQL) para la plataforma ProcureOS. Vive como proyecto hermano del frontend (`bolt_procure`), no dentro de él.

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
homologacion/    formulario + cola de revisión (compliance)
ofertas/         carga de oferta estructurada / comparativo
adjudicacion/    confirmación, revisión legal, firma electrónica simulada
contratos/       repositorio de contratos/POs
seguimiento/     hitos post-PO
disputas/        gestión + mediación de disputas
invitaciones/    bandeja de invitaciones del proveedor
pagos/           centro de pagos / pronto pago
notificaciones/  centro de notificaciones
audit-log/       registro de auditoría transversal
subasta/         WebSocket gateway para negociación/subasta en vivo
interno/         casos de consultor, admin de clientes, benchmark de mercado
```

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

- Este backend reemplaza gradualmente la lógica simulada del frontend (`src/lib/mock/*.ts` en `bolt_procure`). El frontend aún no está conectado a esta API — ese es el siguiente paso.
- El log de auditoría, notificaciones y homologación usan datos reales persistidos en Postgres (a diferencia del store en memoria del frontend).
