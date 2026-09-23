-- CreateEnum
CREATE TYPE "TipoArchivoVitrina" AS ENUM ('IMAGEN', 'BROCHURE', 'CATALOGO');

-- AlterTable
ALTER TABLE "proveedor_profiles" ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "emailContacto" TEXT,
ADD COLUMN     "telefonoContacto" TEXT,
ADD COLUMN     "videoUrl" TEXT,
ADD COLUMN     "vitrinaVistas" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "archivos_vitrina" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "tipo" "TipoArchivoVitrina" NOT NULL,
    "titulo" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_vitrina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_catalogo" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" TEXT,
    "unidad" TEXT,
    "precioReferencia" INTEGER,
    "moneda" "Moneda",
    "imagenPath" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archivos_vitrina_proveedorId_idx" ON "archivos_vitrina"("proveedorId");

-- CreateIndex
CREATE INDEX "items_catalogo_proveedorId_idx" ON "items_catalogo"("proveedorId");

-- AddForeignKey
ALTER TABLE "archivos_vitrina" ADD CONSTRAINT "archivos_vitrina_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_catalogo" ADD CONSTRAINT "items_catalogo_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
