-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "umbralContratoMarco" INTEGER NOT NULL DEFAULT 50000;

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "contratoPadreId" TEXT;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_contratoPadreId_fkey" FOREIGN KEY ("contratoPadreId") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
