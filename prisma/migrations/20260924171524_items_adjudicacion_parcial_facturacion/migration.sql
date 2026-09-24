-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('RADICADA', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "EstadoProntoPago" AS ENUM ('SOLICITADA', 'ACEPTADA', 'RECHAZADA');

-- DropIndex
DROP INDEX "adjudicaciones_requerimientoId_key";

-- AlterTable
ALTER TABLE "adjudicaciones" ADD COLUMN     "contratoId" TEXT;

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "proveedorId" TEXT;

-- AlterTable
ALTER TABLE "pagos_po" ADD COLUMN     "descuentoProntoPago" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fechaPago" TIMESTAMP(3),
ADD COLUMN     "montoPagado" INTEGER,
ADD COLUMN     "pagadoPor" TEXT,
ADD COLUMN     "referenciaPago" TEXT,
ADD COLUMN     "soporteNombre" TEXT,
ADD COLUMN     "soportePath" TEXT;

-- CreateTable
CREATE TABLE "items_requerimiento" (
    "id" TEXT NOT NULL,
    "requerimientoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "unidad" TEXT NOT NULL,
    "especificacion" TEXT,

    CONSTRAINT "items_requerimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_oferta" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "precioUnitario" INTEGER NOT NULL,

    CONSTRAINT "items_oferta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjudicacion_lineas" (
    "id" TEXT NOT NULL,
    "adjudicacionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,

    CONSTRAINT "adjudicacion_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "monto" INTEGER NOT NULL,
    "archivoPath" TEXT NOT NULL,
    "archivoNombre" TEXT NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'RADICADA',
    "motivoRechazo" TEXT,
    "revisadaPor" TEXT,
    "revisadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_pronto_pago" (
    "id" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "fechaPropuesta" TIMESTAMP(3) NOT NULL,
    "descuentoPct" DOUBLE PRECISION NOT NULL,
    "montoNeto" INTEGER NOT NULL,
    "estado" "EstadoProntoPago" NOT NULL DEFAULT 'SOLICITADA',
    "motivo" TEXT,
    "respondidaPor" TEXT,
    "respondidaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_pronto_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "items_requerimiento_requerimientoId_orden_idx" ON "items_requerimiento"("requerimientoId", "orden");

-- CreateIndex
CREATE INDEX "items_oferta_itemId_idx" ON "items_oferta"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "items_oferta_ofertaId_itemId_key" ON "items_oferta"("ofertaId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "adjudicacion_lineas_itemId_key" ON "adjudicacion_lineas"("itemId");

-- CreateIndex
CREATE INDEX "adjudicacion_lineas_adjudicacionId_idx" ON "adjudicacion_lineas"("adjudicacionId");

-- CreateIndex
CREATE INDEX "facturas_pagoId_idx" ON "facturas"("pagoId");

-- CreateIndex
CREATE INDEX "solicitudes_pronto_pago_pagoId_idx" ON "solicitudes_pronto_pago"("pagoId");

-- CreateIndex
CREATE UNIQUE INDEX "adjudicaciones_contratoId_key" ON "adjudicaciones"("contratoId");

-- CreateIndex
CREATE UNIQUE INDEX "adjudicaciones_requerimientoId_proveedorId_key" ON "adjudicaciones"("requerimientoId", "proveedorId");

-- CreateIndex
CREATE INDEX "contratos_proveedorId_idx" ON "contratos"("proveedorId");

-- AddForeignKey
ALTER TABLE "items_requerimiento" ADD CONSTRAINT "items_requerimiento_requerimientoId_fkey" FOREIGN KEY ("requerimientoId") REFERENCES "requerimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_oferta" ADD CONSTRAINT "items_oferta_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "ofertas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_oferta" ADD CONSTRAINT "items_oferta_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items_requerimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicaciones" ADD CONSTRAINT "adjudicaciones_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicaciones" ADD CONSTRAINT "adjudicaciones_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicacion_lineas" ADD CONSTRAINT "adjudicacion_lineas_adjudicacionId_fkey" FOREIGN KEY ("adjudicacionId") REFERENCES "adjudicaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudicacion_lineas" ADD CONSTRAINT "adjudicacion_lineas_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items_requerimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "pagos_po"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_pronto_pago" ADD CONSTRAINT "solicitudes_pronto_pago_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "pagos_po"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: until now a requerimiento had at most one adjudicación, so its
-- contract(s) — and any PO issued under them — belong to that proveedor.
UPDATE "contratos" c SET "proveedorId" = a."proveedorId"
FROM "adjudicaciones" a
WHERE c."requerimientoId" = a."requerimientoId" AND c."proveedorId" IS NULL;

UPDATE "contratos" c SET "proveedorId" = p."proveedorId"
FROM "contratos" p
WHERE c."contratoPadreId" = p."id" AND c."proveedorId" IS NULL;

UPDATE "adjudicaciones" a SET "contratoId" = c."id"
FROM "contratos" c
WHERE c."requerimientoId" = a."requerimientoId" AND c."contratoPadreId" IS NULL
  AND a."firmado" = true AND a."contratoId" IS NULL;
