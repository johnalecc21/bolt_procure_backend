-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "condicionesPagoDias" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "hitos_seguimiento" ADD COLUMN     "porcentaje" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagoGeneradoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hitos_seguimiento_pagoGeneradoId_key" ON "hitos_seguimiento"("pagoGeneradoId");

-- AddForeignKey
ALTER TABLE "hitos_seguimiento" ADD CONSTRAINT "hitos_seguimiento_pagoGeneradoId_fkey" FOREIGN KEY ("pagoGeneradoId") REFERENCES "pagos_po"("id") ON DELETE SET NULL ON UPDATE CASCADE;
