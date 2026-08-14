-- AlterTable
ALTER TABLE "contratos" ADD COLUMN "numero" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "contratos_numero_key" ON "contratos"("numero");
