-- AlterTable
ALTER TABLE "marca_documentos" ADD COLUMN     "penalidadActiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "penalidadBase" TEXT NOT NULL DEFAULT 'HITO',
ADD COLUMN     "penalidadDiaria" DOUBLE PRECISION,
ADD COLUMN     "penalidadDiasGracia" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "penalidadTexto" TEXT,
ADD COLUMN     "penalidadTope" DOUBLE PRECISION;

