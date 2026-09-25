-- CreateEnum
CREATE TYPE "TipoPlantilla" AS ENUM ('CONTRATO_MARCO', 'ORDEN_COMPRA');

-- AlterTable
ALTER TABLE "versiones_documento_contrato" ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "plantillaId" TEXT,
ADD COLUMN     "storagePathEditable" TEXT;

-- CreateTable
CREATE TABLE "plantillas_documento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "TipoPlantilla" NOT NULL,
    "categoria" TEXT,
    "nombre" TEXT NOT NULL,
    "archivoNombre" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "tamanoBytes" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "marcadores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "advertencias" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subidaPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plantillas_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marca_documentos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "razonSocial" TEXT,
    "nit" TEXT,
    "direccion" TEXT,
    "ciudad" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "sitioWeb" TEXT,
    "representanteLegal" TEXT,
    "cargoRepresentante" TEXT,
    "colorPrimario" TEXT,
    "logoPath" TEXT,
    "clausulas" TEXT,
    "piePagina" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marca_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plantillas_documento_companyId_tipo_activa_idx" ON "plantillas_documento"("companyId", "tipo", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "marca_documentos_companyId_key" ON "marca_documentos"("companyId");

-- AddForeignKey
ALTER TABLE "plantillas_documento" ADD CONSTRAINT "plantillas_documento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marca_documentos" ADD CONSTRAINT "marca_documentos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

