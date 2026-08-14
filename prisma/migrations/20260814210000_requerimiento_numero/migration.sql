-- AlterTable
ALTER TABLE "requerimientos" ADD COLUMN "numero" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "requerimientos_numero_key" ON "requerimientos"("numero");
