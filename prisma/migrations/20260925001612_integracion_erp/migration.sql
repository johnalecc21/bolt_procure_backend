-- CreateEnum
CREATE TYPE "ModoIntegracion" AS ENUM ('ARCHIVO', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "TipoEventoErp" AS ENUM ('PROVEEDOR', 'ORDEN_COMPRA', 'RECEPCION', 'FACTURA', 'PAGO');

-- CreateEnum
CREATE TYPE "EstadoEventoErp" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR', 'FALLIDO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "TipoMapeoErp" AS ENUM ('CENTRO_COSTO', 'CATEGORIA');

-- AlterTable
ALTER TABLE "proveedor_profiles" ADD COLUMN     "nit" TEXT;

-- CreateTable
CREATE TABLE "integraciones_erp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "modo" "ModoIntegracion" NOT NULL DEFAULT 'ARCHIVO',
    "sistema" TEXT,
    "webhookUrl" TEXT,
    "secretoCifrado" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyPrefijo" TEXT,
    "eventos" "TipoEventoErp"[] DEFAULT ARRAY[]::"TipoEventoErp"[],
    "ultimaPrueba" TIMESTAMP(3),
    "ultimaPruebaOk" BOOLEAN,
    "ultimaPruebaMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integraciones_erp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapeos_erp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "TipoMapeoErp" NOT NULL,
    "valorLocal" TEXT NOT NULL,
    "valorErp" TEXT NOT NULL,

    CONSTRAINT "mapeos_erp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_erp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "TipoEventoErp" NOT NULL,
    "entidadId" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "estado" "EstadoEventoErp" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximoIntento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoError" TEXT,
    "idExterno" TEXT,
    "enviadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_erp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integraciones_erp_companyId_key" ON "integraciones_erp"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "mapeos_erp_companyId_tipo_valorLocal_key" ON "mapeos_erp"("companyId", "tipo", "valorLocal");

-- CreateIndex
CREATE INDEX "eventos_erp_estado_proximoIntento_idx" ON "eventos_erp"("estado", "proximoIntento");

-- CreateIndex
CREATE INDEX "eventos_erp_companyId_estado_idx" ON "eventos_erp"("companyId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_erp_companyId_tipo_entidadId_key" ON "eventos_erp"("companyId", "tipo", "entidadId");

-- AddForeignKey
ALTER TABLE "integraciones_erp" ADD CONSTRAINT "integraciones_erp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapeos_erp" ADD CONSTRAINT "mapeos_erp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_erp" ADD CONSTRAINT "eventos_erp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The tax id already read by OCR during homologación becomes the starting NIT.
UPDATE "proveedor_profiles" p SET "nit" = h."nitDetectado"
FROM "homologaciones" h
WHERE h."proveedorId" = p."id" AND p."nit" IS NULL AND h."nitDetectado" IS NOT NULL;
