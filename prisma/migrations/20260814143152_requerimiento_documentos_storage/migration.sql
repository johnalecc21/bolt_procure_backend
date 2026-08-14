-- AlterTable
ALTER TABLE "documentos_requerimiento" ADD COLUMN     "estado" "EstadoDocumento" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "storagePath" TEXT;
