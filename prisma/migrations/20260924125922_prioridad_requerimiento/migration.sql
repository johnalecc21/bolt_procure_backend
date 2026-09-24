-- CreateEnum
CREATE TYPE "PrioridadRequerimiento" AS ENUM ('NORMAL', 'ALTA', 'URGENTE');

-- AlterTable
ALTER TABLE "requerimientos" ADD COLUMN     "prioridad" "PrioridadRequerimiento" NOT NULL DEFAULT 'NORMAL';
