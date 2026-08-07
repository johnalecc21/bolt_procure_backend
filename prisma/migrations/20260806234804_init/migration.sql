-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('CLIENTE', 'PROVEEDOR', 'INTERNO');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('COMPRADOR', 'APROBADOR_CFO', 'ADMIN_CLIENTE', 'PROVEEDOR', 'CONSULTOR', 'COMPLIANCE_OPS');

-- CreateEnum
CREATE TYPE "EstadoRequerimiento" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'EN_LICITACION', 'EN_NEGOCIACION', 'ADJUDICADO', 'EN_CUMPLIMIENTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "EstadoHomologacion" AS ENUM ('EN_REVISION', 'APROBADO', 'RECHAZADO', 'ZONA_GRIS');

-- CreateEnum
CREATE TYPE "EstadoDocumento" AS ENUM ('PENDIENTE', 'SUBIDO', 'VALIDADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "TipoContrato" AS ENUM ('CONTRATO', 'PO', 'ADDENDUM');

-- CreateEnum
CREATE TYPE "EstadoContrato" AS ENUM ('ACTIVO', 'POR_VENCER', 'VENCIDO', 'EN_RENOVACION');

-- CreateEnum
CREATE TYPE "TipoAprobacion" AS ENUM ('SALIDA_LICITACION', 'ADJUDICACION', 'EXCEPCION_PRESUPUESTO');

-- CreateEnum
CREATE TYPE "EstadoAprobacion" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "TipoRegla" AS ENUM ('UNICA', 'SECUENCIAL');

-- CreateEnum
CREATE TYPE "EstadoHito" AS ENUM ('COMPLETADO', 'EN_RIESGO', 'ATRASADO', 'PENDIENTE');

-- CreateEnum
CREATE TYPE "Severidad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "EstadoDisputa" AS ENUM ('ABIERTA', 'EN_MEDIACION', 'RESUELTA');

-- CreateEnum
CREATE TYPE "EstadoInvitacion" AS ENUM ('NUEVA', 'VISTA', 'RESPONDIDA', 'VENCIDA', 'DECLINADA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'PAGADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('APROBACION', 'OFERTA', 'CONTRATO', 'NEGOCIACION', 'PROVEEDOR', 'DISPUTA');

-- CreateEnum
CREATE TYPE "EstadoCaso" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'ESCALADO');

-- CreateEnum
CREATE TYPE "Prioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "PlanCliente" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "EstadoFacturacion" AS ENUM ('AL_DIA', 'PENDIENTE', 'VENCIDA');

-- CreateEnum
CREATE TYPE "EstadoSubasta" AS ENUM ('INACTIVA', 'ACTIVA', 'CERRADA');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "plan" "PlanCliente" NOT NULL DEFAULT 'STARTER',
    "facturacion" "EstadoFacturacion" NOT NULL DEFAULT 'AL_DIA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "portal" "Portal" NOT NULL,
    "role" "Role" NOT NULL,
    "iniciales" TEXT NOT NULL,
    "cargo" TEXT,
    "requires2FA" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requerimientos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "estado" "EstadoRequerimiento" NOT NULL DEFAULT 'BORRADOR',
    "montoEstimado" INTEGER NOT NULL,
    "fechaLimite" TIMESTAMP(3) NOT NULL,
    "progreso" INTEGER NOT NULL DEFAULT 0,
    "proveedoresInvitados" INTEGER NOT NULL DEFAULT 0,
    "ofertasRecibidas" INTEGER NOT NULL DEFAULT 0,
    "solicitanteId" TEXT NOT NULL,
    "criteriosPeso" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requerimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comentarios_requerimiento" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comentarios_requerimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_requerimiento" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_requerimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aprobaciones" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "tipo" "TipoAprobacion" NOT NULL,
    "monto" INTEGER NOT NULL,
    "urgente" BOOLEAN NOT NULL DEFAULT false,
    "estado" "EstadoAprobacion" NOT NULL DEFAULT 'PENDIENTE',
    "motivoRechazo" TEXT,
    "resueltoPorId" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprobaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriz_aprobacion_reglas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "montoMin" INTEGER NOT NULL,
    "montoMax" INTEGER,
    "aprobadores" TEXT NOT NULL,
    "tipo" "TipoRegla" NOT NULL DEFAULT 'UNICA',

    CONSTRAINT "matriz_aprobacion_reglas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedor_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "nombre" TEXT NOT NULL,
    "iniciales" TEXT NOT NULL,
    "categorias" TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "ubicacion" TEXT NOT NULL,
    "certificaciones" TEXT[],
    "procesosGanados" INTEGER NOT NULL DEFAULT 0,
    "entregasATiempo" INTEGER NOT NULL DEFAULT 0,
    "disputasCount" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homologaciones" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "estado" "EstadoHomologacion" NOT NULL DEFAULT 'EN_REVISION',
    "score" INTEGER NOT NULL DEFAULT 0,
    "alertas" TEXT[],
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proximaRevalidacion" TIMESTAMP(3),

    CONSTRAINT "homologaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_homologacion" (
    "id" TEXT NOT NULL,
    "homologacionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'PENDIENTE',
    "vigencia" TIMESTAMP(3),

    CONSTRAINT "documentos_homologacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "precioTotal" INTEGER NOT NULL,
    "plazoEntregaDias" INTEGER NOT NULL,
    "condicionesPagoDias" INTEGER NOT NULL,
    "garantiaMeses" INTEGER NOT NULL,
    "vigenciaOfertaDias" INTEGER NOT NULL,
    "calidad" INTEGER NOT NULL DEFAULT 80,
    "enviada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjudicaciones" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "precioFinal" INTEGER NOT NULL,
    "plazoDias" INTEGER NOT NULL,
    "condicionesPagoDias" INTEGER NOT NULL,
    "garantiaMeses" INTEGER NOT NULL,
    "poId" TEXT NOT NULL,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "revisionLegal" BOOLEAN NOT NULL DEFAULT false,
    "firmado" BOOLEAN NOT NULL DEFAULT false,
    "notificarPerdedores" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjudicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requerimientoId" TEXT,
    "tipo" "TipoContrato" NOT NULL,
    "proveedorNombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFin" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoContrato" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hitos_seguimiento" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "comprometido" TIMESTAMP(3) NOT NULL,
    "real" TIMESTAMP(3),
    "estado" "EstadoHito" NOT NULL DEFAULT 'PENDIENTE',
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hitos_seguimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "poReferencia" TEXT NOT NULL,
    "proveedorId" TEXT,
    "severidad" "Severidad" NOT NULL DEFAULT 'MEDIA',
    "estado" "EstadoDisputa" NOT NULL DEFAULT 'ABIERTA',
    "mediadorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "disputas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_disputa" (
    "id" TEXT NOT NULL,
    "disputaId" TEXT NOT NULL,
    "autorId" TEXT,
    "autor" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_disputa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT,
    "proveedorId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "fechaLimite" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoInvitacion" NOT NULL DEFAULT 'NUEVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_po" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaPagoPactada" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "disputaAbierta" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pagos_po_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "usuario" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casos_consultor" (
    "id" TEXT NOT NULL,
    "consultorId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridad" "Prioridad" NOT NULL DEFAULT 'MEDIA',
    "estado" "EstadoCaso" NOT NULL DEFAULT 'PENDIENTE',
    "slaVencido" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "casos_consultor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_entries" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "precioPromedio" INTEGER NOT NULL,
    "muestras" INTEGER NOT NULL,
    "outlier" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "benchmark_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_sessions" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "status" "EstadoSubasta" NOT NULL DEFAULT 'INACTIVA',
    "deadline" TIMESTAMP(3),

    CONSTRAINT "auction_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pujas" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "proveedorNombre" TEXT NOT NULL,
    "montoInicial" INTEGER NOT NULL,
    "monto" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pujas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_userId_companyId_key" ON "company_memberships"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "proveedor_profiles_userId_key" ON "proveedor_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "homologaciones_proveedorId_key" ON "homologaciones"("proveedorId");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_requerimientoId_proveedorId_key" ON "ofertas"("requerimientoId", "proveedorId");

-- CreateIndex
CREATE UNIQUE INDEX "adjudicaciones_requerimientoId_key" ON "adjudicaciones"("requerimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_sessions_requerimientoId_key" ON "auction_sessions"("requerimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "pujas_sessionId_proveedorId_key" ON "pujas"("sessionId", "proveedorId");

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos" ADD CONSTRAINT "requerimientos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos" ADD CONSTRAINT "requerimientos_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_requerimiento" ADD CONSTRAINT "comentarios_requerimiento_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_requerimiento" ADD CONSTRAINT "documentos_requerimiento_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones" ADD CONSTRAINT "aprobaciones_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones" ADD CONSTRAINT "aprobaciones_resueltoPorId_fkey" FOREIGN KEY ("resueltoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriz_aprobacion_reglas" ADD CONSTRAINT "matriz_aprobacion_reglas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_profiles" ADD CONSTRAINT "proveedor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homologaciones" ADD CONSTRAINT "homologaciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_homologacion" ADD CONSTRAINT "documentos_homologacion_homologacionId_fkey" FOREIGN KEY ("homologacionId") REFERENCES "homologaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicaciones" ADD CONSTRAINT "adjudicaciones_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitos_seguimiento" ADD CONSTRAINT "hitos_seguimiento_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputas" ADD CONSTRAINT "disputas_mediadorId_fkey" FOREIGN KEY ("mediadorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_disputa" ADD CONSTRAINT "mensajes_disputa_disputaId_fkey" FOREIGN KEY ("disputaId") REFERENCES "disputas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_disputa" ADD CONSTRAINT "mensajes_disputa_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_po" ADD CONSTRAINT "pagos_po_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_po" ADD CONSTRAINT "pagos_po_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casos_consultor" ADD CONSTRAINT "casos_consultor_consultorId_fkey" FOREIGN KEY ("consultorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casos_consultor" ADD CONSTRAINT "casos_consultor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_sessions" ADD CONSTRAINT "auction_sessions_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pujas" ADD CONSTRAINT "pujas_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "auction_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
