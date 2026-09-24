-- DropIndex
DROP INDEX "audit_log_companyId_idx";

-- DropIndex
DROP INDEX "requerimientos_companyId_idx";

-- CreateIndex
CREATE INDEX "aprobacion_pasos_aprobacionId_idx" ON "aprobacion_pasos"("aprobacionId");

-- CreateIndex
CREATE INDEX "aprobaciones_requerimientoId_idx" ON "aprobaciones"("requerimientoId");

-- CreateIndex
CREATE INDEX "audit_log_companyId_createdAt_idx" ON "audit_log"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "comentarios_requerimiento_requerimientoId_idx" ON "comentarios_requerimiento"("requerimientoId");

-- CreateIndex
CREATE INDEX "contratos_requerimientoId_idx" ON "contratos"("requerimientoId");

-- CreateIndex
CREATE INDEX "documentos_homologacion_homologacionId_idx" ON "documentos_homologacion"("homologacionId");

-- CreateIndex
CREATE INDEX "documentos_requerimiento_requerimientoId_idx" ON "documentos_requerimiento"("requerimientoId");

-- CreateIndex
CREATE INDEX "hitos_seguimiento_contratoId_idx" ON "hitos_seguimiento"("contratoId");

-- CreateIndex
CREATE INDEX "matriz_aprobacion_reglas_companyId_idx" ON "matriz_aprobacion_reglas"("companyId");

-- CreateIndex
CREATE INDEX "mensajes_disputa_disputaId_idx" ON "mensajes_disputa"("disputaId");

-- CreateIndex
CREATE INDEX "notificaciones_userId_createdAt_idx" ON "notificaciones"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pagos_po_contratoId_idx" ON "pagos_po"("contratoId");

-- CreateIndex
CREATE INDEX "requerimientos_companyId_createdAt_idx" ON "requerimientos"("companyId", "createdAt");
