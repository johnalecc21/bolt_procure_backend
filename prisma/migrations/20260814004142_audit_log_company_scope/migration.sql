-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "audit_log_companyId_idx" ON "audit_log"("companyId");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
