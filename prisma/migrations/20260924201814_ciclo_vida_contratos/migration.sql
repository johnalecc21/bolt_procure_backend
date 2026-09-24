-- CreateEnum
CREATE TYPE "TipoModificacion" AS ENUM ('PRORROGA', 'MONTO', 'TERMINACION');

-- AlterEnum
ALTER TYPE "EstadoContrato" ADD VALUE 'TERMINADO';

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "motivoTerminacion" TEXT,
ADD COLUMN     "terminadoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "hitos_seguimiento" ADD COLUMN     "avanceProveedor" TEXT,
ADD COLUMN     "avanceReportadoAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "modificaciones_contrato" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "tipo" "TipoModificacion" NOT NULL,
    "motivo" TEXT NOT NULL,
    "vigenciaAntes" TIMESTAMP(3),
    "vigenciaDespues" TIMESTAMP(3),
    "montoAntes" INTEGER,
    "montoDespues" INTEGER,
    "usuario" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modificaciones_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versiones_documento_contrato" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "tamanoBytes" INTEGER,
    "subidoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versiones_documento_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modificaciones_contrato_contratoId_idx" ON "modificaciones_contrato"("contratoId");

-- CreateIndex
CREATE INDEX "versiones_documento_contrato_contratoId_createdAt_idx" ON "versiones_documento_contrato"("contratoId", "createdAt");

-- AddForeignKey
ALTER TABLE "modificaciones_contrato" ADD CONSTRAINT "modificaciones_contrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_documento_contrato" ADD CONSTRAINT "versiones_documento_contrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The file each contract already has becomes its first version.
INSERT INTO "versiones_documento_contrato" ("id", "contratoId", "nombre", "storagePath", "tamanoBytes", "subidoPor", "createdAt")
SELECT 'v_' || c."id", c."id", c."archivoNombre", c."archivoStoragePath", c."archivoTamanoBytes", 'sistema', c."createdAt"
FROM "contratos" c
WHERE c."archivoStoragePath" IS NOT NULL AND c."archivoNombre" IS NOT NULL;
