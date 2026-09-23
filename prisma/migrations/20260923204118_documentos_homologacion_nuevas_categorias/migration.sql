-- Separate from the migration that adds the enum values: Postgres can't use a
-- freshly added enum value inside the same transaction that added it.

-- Every existing homologación gets the four new (optional) documents so
-- proveedores can complete them without a separate onboarding step.
INSERT INTO "documentos_homologacion" ("id", "homologacionId", "nombre", "categoria", "obligatorio", "estado")
SELECT gen_random_uuid()::text, h."id", d."nombre", d."categoria"::"CategoriaDocumento", false, 'PENDIENTE'
FROM "homologaciones" h
CROSS JOIN (VALUES
  ('Certificación SG-SST / RUC (HSE)', 'HSE'),
  ('Política o reporte de sostenibilidad', 'SOSTENIBILIDAD'),
  ('Reporte de centrales de riesgo', 'RIESGO_FINANCIERO'),
  ('Formulario SARLAFT / conocimiento del proveedor', 'LAFT')
) AS d("nombre", "categoria")
WHERE NOT EXISTS (
  SELECT 1 FROM "documentos_homologacion" x
  WHERE x."homologacionId" = h."id" AND x."categoria" = d."categoria"::"CategoriaDocumento"
);

-- Approval never used to mark documents VALIDADO, so already-approved
-- proveedores would fail any per-company document requirement. Their
-- uploaded documents were in fact reviewed as part of that approval.
UPDATE "documentos_homologacion" d
SET "estado" = 'VALIDADO'
FROM "homologaciones" h
WHERE d."homologacionId" = h."id"
  AND h."estado" = 'APROBADO'
  AND d."estado" = 'SUBIDO';
