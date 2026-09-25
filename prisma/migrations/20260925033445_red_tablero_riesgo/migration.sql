-- CreateEnum
CREATE TYPE "TipoAlertaRiesgo" AS ENUM ('LISTA_RESTRICTIVA', 'DOCUMENTO_VENCIDO', 'REVALIDACION');

-- CreateEnum
CREATE TYPE "EstadoAlertaRiesgo" AS ENUM ('ABIERTA', 'RESUELTA');

-- AlterTable
ALTER TABLE "documentos_homologacion" ADD COLUMN     "avisoVencimiento" INTEGER;

-- AlterTable
ALTER TABLE "homologaciones" ADD COLUMN     "ultimoMonitoreo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invitaciones" ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'INVITACION',
ADD COLUMN     "respondidaAt" TIMESTAMP(3),
ADD COLUMN     "vistaAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ofertas" ADD COLUMN     "enviadaAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "requerimientos" ADD COLUMN     "abiertoRed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "alertas_riesgo" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "tipo" "TipoAlertaRiesgo" NOT NULL,
    "detalle" TEXT NOT NULL,
    "estado" "EstadoAlertaRiesgo" NOT NULL DEFAULT 'ABIERTA',
    "documentoId" TEXT,
    "resolucion" TEXT,
    "resueltaPor" TEXT,
    "resueltaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_riesgo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alertas_riesgo_estado_createdAt_idx" ON "alertas_riesgo"("estado", "createdAt");

-- CreateIndex
CREATE INDEX "alertas_riesgo_proveedorId_estado_idx" ON "alertas_riesgo"("proveedorId", "estado");

-- AddForeignKey
ALTER TABLE "alertas_riesgo" ADD CONSTRAINT "alertas_riesgo_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ofertas ya enviadas: su fecha de envío aproximada es la de creación.
UPDATE "ofertas" SET "enviadaAt" = "createdAt" WHERE "enviada" = true AND "enviadaAt" IS NULL;
