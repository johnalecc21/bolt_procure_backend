-- AlterTable
ALTER TABLE "users" ADD COLUMN     "terminosAceptadosEn" TIMESTAMP(3);

-- Existing users predate this gate — treat them as already accepted so they
-- aren't interrupted on their next login. Only users created after this
-- migration (new invites/registrations) get NULL and see the acceptance modal.
UPDATE "users" SET "terminosAceptadosEn" = "createdAt";
