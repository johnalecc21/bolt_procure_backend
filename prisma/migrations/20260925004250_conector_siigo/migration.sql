-- AlterEnum
ALTER TYPE "ModoIntegracion" ADD VALUE 'SIIGO';

-- AlterTable
ALTER TABLE "eventos_erp" ADD COLUMN     "referenciaExterna" TEXT;

-- AlterTable
ALTER TABLE "integraciones_erp" ADD COLUMN     "conectorConfig" JSONB,
ADD COLUMN     "conectorCredencial" TEXT;

