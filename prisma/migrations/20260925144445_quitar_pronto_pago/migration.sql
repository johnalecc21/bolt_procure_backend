-- DropForeignKey
ALTER TABLE "solicitudes_pronto_pago" DROP CONSTRAINT "solicitudes_pronto_pago_pagoId_fkey";

-- AlterTable
ALTER TABLE "pagos_po" DROP COLUMN "descuentoProntoPago";

-- DropTable
DROP TABLE "solicitudes_pronto_pago";

-- DropEnum
DROP TYPE "EstadoProntoPago";

