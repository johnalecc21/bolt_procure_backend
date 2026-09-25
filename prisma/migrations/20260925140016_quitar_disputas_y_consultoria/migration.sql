-- Disputas se retiran de la plataforma: sus notificaciones se borran antes
-- de quitar el valor DISPUTA del enum (si no, el cambio de tipo falla).
DELETE FROM "notificaciones" WHERE "tipo" = 'DISPUTA';

-- AlterEnum
BEGIN;
CREATE TYPE "TipoNotificacion_new" AS ENUM ('APROBACION', 'OFERTA', 'CONTRATO', 'NEGOCIACION', 'PROVEEDOR');
ALTER TABLE "notificaciones" ALTER COLUMN "tipo" TYPE "TipoNotificacion_new" USING ("tipo"::text::"TipoNotificacion_new");
ALTER TYPE "TipoNotificacion" RENAME TO "TipoNotificacion_old";
ALTER TYPE "TipoNotificacion_new" RENAME TO "TipoNotificacion";
DROP TYPE "public"."TipoNotificacion_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "casos_consultor" DROP CONSTRAINT "casos_consultor_companyId_fkey";

-- DropForeignKey
ALTER TABLE "casos_consultor" DROP CONSTRAINT "casos_consultor_consultorId_fkey";

-- DropForeignKey
ALTER TABLE "disputas" DROP CONSTRAINT "disputas_companyId_fkey";

-- DropForeignKey
ALTER TABLE "disputas" DROP CONSTRAINT "disputas_mediadorId_fkey";

-- DropForeignKey
ALTER TABLE "disputas" DROP CONSTRAINT "disputas_proveedorId_fkey";

-- DropForeignKey
ALTER TABLE "mensajes_disputa" DROP CONSTRAINT "mensajes_disputa_autorId_fkey";

-- DropForeignKey
ALTER TABLE "mensajes_disputa" DROP CONSTRAINT "mensajes_disputa_disputaId_fkey";

-- AlterTable
ALTER TABLE "pagos_po" DROP COLUMN "disputaAbierta";

-- AlterTable
ALTER TABLE "proveedor_profiles" DROP COLUMN "disputasCount";

-- DropTable
DROP TABLE "benchmark_entries";

-- DropTable
DROP TABLE "casos_consultor";

-- DropTable
DROP TABLE "disputas";

-- DropTable
DROP TABLE "mensajes_disputa";

-- DropEnum
DROP TYPE "EstadoCaso";

-- DropEnum
DROP TYPE "EstadoDisputa";

-- DropEnum
DROP TYPE "Prioridad";

-- DropEnum
DROP TYPE "Severidad";

