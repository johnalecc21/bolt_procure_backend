-- AlterTable
ALTER TABLE "proveedor_profiles" ADD COLUMN     "onboardingCompletado" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows predate the onboarding wizard — treat them as already onboarded so
-- current demo/seed accounts aren't suddenly redirected on their next login. Only
-- future self-registrations (which get the column default, false) go through it.
UPDATE "proveedor_profiles" SET "onboardingCompletado" = true;
