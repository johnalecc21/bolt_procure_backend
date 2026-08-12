-- AlterTable
ALTER TABLE "invitaciones" ADD COLUMN     "enviada" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows were all created by the old "send now" invitarProveedores
-- flow, so they represent invitations that were actually sent.
UPDATE "invitaciones" SET "enviada" = true;
