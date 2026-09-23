-- CreateEnum
CREATE TYPE "NivelRiesgo" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'CRITICO');

-- AlterTable: add the Cuestionario de Homologación fields, the weighted-score breakdown,
-- the risk tier and the "solicitar información" observations.
ALTER TABLE "homologaciones"
  ADD COLUMN     "cuestionario"  JSONB,
  ADD COLUMN     "scoreDesglose" JSONB,
  ADD COLUMN     "nivelRiesgo"   "NivelRiesgo",
  ADD COLUMN     "observaciones" TEXT;
