-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "recordatorio15Enviado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordatorio30Enviado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordatorio60Enviado" BOOLEAN NOT NULL DEFAULT false;
