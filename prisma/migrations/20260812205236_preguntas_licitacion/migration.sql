-- CreateTable
CREATE TABLE "preguntas" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT,
    "respondidoPorId" TEXT,
    "respondidoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preguntas_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "preguntas" ADD CONSTRAINT "preguntas_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preguntas" ADD CONSTRAINT "preguntas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preguntas" ADD CONSTRAINT "preguntas_respondidoPorId_fkey" FOREIGN KEY ("respondidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
