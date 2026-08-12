-- AlterTable
ALTER TABLE "aprobaciones" ADD COLUMN     "rolesRequeridos" "Role"[] DEFAULT ARRAY[]::"Role"[],
ADD COLUMN     "tipoRegla" "TipoRegla" NOT NULL DEFAULT 'UNICA',
ADD COLUMN     "pasoActual" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "aprobaciones" ALTER COLUMN "rolesRequeridos" SET NOT NULL;

-- AlterTable: add roles[] to matriz_aprobacion_reglas and backfill from the old free-text
-- "aprobadores" column before dropping it. Free-text labels that don't correspond to a
-- real Role ("Gerente de Compras", "CEO") are mapped to their closest real equivalent
-- (ADMIN_CLIENTE) — this is a one-time best-effort backfill, later corrected for real
-- via the Matriz de Aprobación screen.
ALTER TABLE "matriz_aprobacion_reglas" ADD COLUMN     "roles" "Role"[] DEFAULT ARRAY[]::"Role"[];

UPDATE "matriz_aprobacion_reglas" SET "roles" = ARRAY['ADMIN_CLIENTE', 'APROBADOR_CFO']::"Role"[] WHERE "aprobadores" = 'CEO + CFO';
UPDATE "matriz_aprobacion_reglas" SET "roles" = ARRAY['COMPRADOR']::"Role"[] WHERE "roles" = ARRAY[]::"Role"[] AND "aprobadores" ILIKE '%comprador%';
UPDATE "matriz_aprobacion_reglas" SET "roles" = ARRAY['ADMIN_CLIENTE']::"Role"[] WHERE "roles" = ARRAY[]::"Role"[] AND ("aprobadores" ILIKE '%gerente%' OR "aprobadores" ILIKE '%admin%');
UPDATE "matriz_aprobacion_reglas" SET "roles" = ARRAY['APROBADOR_CFO']::"Role"[] WHERE "roles" = ARRAY[]::"Role"[] AND "aprobadores" ILIKE '%cfo%';
UPDATE "matriz_aprobacion_reglas" SET "roles" = ARRAY['ADMIN_CLIENTE']::"Role"[] WHERE "roles" = ARRAY[]::"Role"[] AND "aprobadores" ILIKE '%ceo%';

ALTER TABLE "matriz_aprobacion_reglas" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "matriz_aprobacion_reglas" DROP COLUMN "aprobadores";
