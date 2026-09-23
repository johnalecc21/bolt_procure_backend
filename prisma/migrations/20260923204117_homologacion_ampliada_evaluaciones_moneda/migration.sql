-- CreateEnum
CREATE TYPE "Moneda" AS ENUM ('COP', 'USD', 'MXN', 'PEN', 'CLP', 'BRL');

-- CreateEnum
CREATE TYPE "ResultadoLista" AS ENUM ('SIN_COINCIDENCIA', 'COINCIDENCIA', 'NO_DISPONIBLE', 'PENDIENTE_MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoriaDocumento" ADD VALUE 'HSE';
ALTER TYPE "CategoriaDocumento" ADD VALUE 'SOSTENIBILIDAD';
ALTER TYPE "CategoriaDocumento" ADD VALUE 'RIESGO_FINANCIERO';
ALTER TYPE "CategoriaDocumento" ADD VALUE 'LAFT';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "categoriasHomologacionRequeridas" "CategoriaDocumento"[] DEFAULT ARRAY[]::"CategoriaDocumento"[],
ADD COLUMN     "monedaBase" "Moneda" NOT NULL DEFAULT 'USD',
ADD COLUMN     "pais" TEXT NOT NULL DEFAULT 'CO';

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "moneda" "Moneda" NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "documentos_homologacion" ADD COLUMN     "obligatorio" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "pagos_po" ADD COLUMN     "moneda" "Moneda" NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "proveedor_profiles" ADD COLUMN     "desempenoPromedio" DOUBLE PRECISION,
ADD COLUMN     "evaluacionesCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "requerimientos" ADD COLUMN     "moneda" "Moneda" NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "verificaciones_lista" (
    "id" TEXT NOT NULL,
    "homologacionId" TEXT NOT NULL,
    "lista" TEXT NOT NULL,
    "resultado" "ResultadoLista" NOT NULL,
    "detalle" TEXT,
    "verificadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verificaciones_lista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_desempeno" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "evaluadorId" TEXT NOT NULL,
    "calidad" INTEGER NOT NULL,
    "plazos" INTEGER NOT NULL,
    "servicio" INTEGER NOT NULL,
    "hse" INTEGER NOT NULL,
    "puntaje" INTEGER NOT NULL,
    "comentario" TEXT,
    "requierePlanMejora" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluaciones_desempeno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verificaciones_lista_homologacionId_lista_key" ON "verificaciones_lista"("homologacionId", "lista");

-- CreateIndex
CREATE INDEX "evaluaciones_desempeno_proveedorId_idx" ON "evaluaciones_desempeno"("proveedorId");

-- CreateIndex
CREATE INDEX "evaluaciones_desempeno_contratoId_idx" ON "evaluaciones_desempeno"("contratoId");

-- CreateIndex
CREATE INDEX "evaluaciones_desempeno_companyId_idx" ON "evaluaciones_desempeno"("companyId");

-- AddForeignKey
ALTER TABLE "verificaciones_lista" ADD CONSTRAINT "verificaciones_lista_homologacionId_fkey" FOREIGN KEY ("homologacionId") REFERENCES "homologaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_desempeno" ADD CONSTRAINT "evaluaciones_desempeno_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_desempeno" ADD CONSTRAINT "evaluaciones_desempeno_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_desempeno" ADD CONSTRAINT "evaluaciones_desempeno_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_desempeno" ADD CONSTRAINT "evaluaciones_desempeno_evaluadorId_fkey" FOREIGN KEY ("evaluadorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
