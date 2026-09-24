-- CreateTable
CREATE TABLE "graficas_guardadas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "metrica" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graficas_guardadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "graficas_guardadas_userId_companyId_idx" ON "graficas_guardadas"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "graficas_guardadas" ADD CONSTRAINT "graficas_guardadas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graficas_guardadas" ADD CONSTRAINT "graficas_guardadas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
