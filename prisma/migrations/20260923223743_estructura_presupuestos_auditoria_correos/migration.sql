-- CreateEnum
CREATE TYPE "TipoUnidadNegocio" AS ENUM ('SEDE', 'UNIDAD_NEGOCIO');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "exigeCentroCosto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retencionAuditoriaMeses" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "archivoTamanoBytes" INTEGER,
ADD COLUMN     "centroCostoId" TEXT;

-- AlterTable
ALTER TABLE "documentos_requerimiento" ADD COLUMN     "tamanoBytes" INTEGER;

-- AlterTable
ALTER TABLE "requerimientos" ADD COLUMN     "centroCostoId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recibirCorreos" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "unidades_negocio" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoUnidadNegocio" NOT NULL DEFAULT 'SEDE',
    "ciudad" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidades_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centros_costo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unidadNegocioId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "responsable" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centros_costo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuestos_centro_costo" (
    "id" TEXT NOT NULL,
    "centroCostoId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "monto" INTEGER NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuestos_centro_costo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unidades_negocio_companyId_codigo_key" ON "unidades_negocio"("companyId", "codigo");

-- CreateIndex
CREATE INDEX "centros_costo_unidadNegocioId_idx" ON "centros_costo"("unidadNegocioId");

-- CreateIndex
CREATE UNIQUE INDEX "centros_costo_companyId_codigo_key" ON "centros_costo"("companyId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_centro_costo_centroCostoId_anio_key" ON "presupuestos_centro_costo"("centroCostoId", "anio");

-- CreateIndex
CREATE INDEX "requerimientos_centroCostoId_idx" ON "requerimientos"("centroCostoId");

-- AddForeignKey
ALTER TABLE "requerimientos" ADD CONSTRAINT "requerimientos_centroCostoId_fkey" FOREIGN KEY ("centroCostoId") REFERENCES "centros_costo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_centroCostoId_fkey" FOREIGN KEY ("centroCostoId") REFERENCES "centros_costo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_negocio" ADD CONSTRAINT "unidades_negocio_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centros_costo" ADD CONSTRAINT "centros_costo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centros_costo" ADD CONSTRAINT "centros_costo_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos_centro_costo" ADD CONSTRAINT "presupuestos_centro_costo_centroCostoId_fkey" FOREIGN KEY ("centroCostoId") REFERENCES "centros_costo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
