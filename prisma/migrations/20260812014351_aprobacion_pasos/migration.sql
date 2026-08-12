-- AlterTable
ALTER TABLE "aprobaciones" ALTER COLUMN "rolesRequeridos" DROP DEFAULT;

-- AlterTable
ALTER TABLE "matriz_aprobacion_reglas" ALTER COLUMN "roles" DROP DEFAULT;

-- CreateTable
CREATE TABLE "aprobacion_pasos" (
    "id" TEXT NOT NULL,
    "aprobacionId" TEXT NOT NULL,
    "rol" "Role" NOT NULL,
    "aprobadoPorId" TEXT NOT NULL,
    "aprobadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprobacion_pasos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "aprobacion_pasos" ADD CONSTRAINT "aprobacion_pasos_aprobacionId_fkey" FOREIGN KEY ("aprobacionId") REFERENCES "aprobaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobacion_pasos" ADD CONSTRAINT "aprobacion_pasos_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
