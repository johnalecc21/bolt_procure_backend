-- CreateEnum
CREATE TYPE "CategoriaDocumento" AS ENUM ('LEGAL', 'FINANCIERO', 'CERTIFICACIONES', 'REFERENCIAS');

-- AlterTable
ALTER TABLE "documentos_homologacion" ADD COLUMN     "categoria" "CategoriaDocumento" NOT NULL DEFAULT 'LEGAL';

-- AlterTable
ALTER TABLE "homologaciones" ALTER COLUMN "estado" SET DEFAULT 'BORRADOR';

-- Backfill categoria on existing rows by document name (new column defaulted everything to LEGAL above)
UPDATE "documentos_homologacion" SET "categoria" = 'FINANCIERO' WHERE "nombre" ILIKE '%financ%';
UPDATE "documentos_homologacion" SET "categoria" = 'CERTIFICACIONES' WHERE "nombre" ILIKE '%certificad%' OR "nombre" ILIKE '%iso%' OR "nombre" ILIKE '%basc%' OR "nombre" ILIKE '%esg%';
UPDATE "documentos_homologacion" SET "categoria" = 'REFERENCIAS' WHERE "nombre" ILIKE '%referencia%';
