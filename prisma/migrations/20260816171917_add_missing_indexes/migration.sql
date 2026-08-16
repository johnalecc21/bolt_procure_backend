-- CreateIndex
CREATE INDEX "casos_consultor_consultorId_idx" ON "casos_consultor"("consultorId");

-- CreateIndex
CREATE INDEX "casos_consultor_companyId_idx" ON "casos_consultor"("companyId");

-- CreateIndex
CREATE INDEX "contratos_companyId_idx" ON "contratos"("companyId");

-- CreateIndex
CREATE INDEX "contratos_estado_idx" ON "contratos"("estado");

-- CreateIndex
CREATE INDEX "disputas_companyId_idx" ON "disputas"("companyId");

-- CreateIndex
CREATE INDEX "homologaciones_estado_idx" ON "homologaciones"("estado");

-- CreateIndex
CREATE INDEX "invitaciones_proveedorId_idx" ON "invitaciones"("proveedorId");

-- CreateIndex
CREATE INDEX "invitaciones_requerimientoId_idx" ON "invitaciones"("requerimientoId");

-- CreateIndex
CREATE INDEX "notificaciones_userId_leida_idx" ON "notificaciones"("userId", "leida");

-- CreateIndex
CREATE INDEX "ofertas_proveedorId_idx" ON "ofertas"("proveedorId");

-- CreateIndex
CREATE INDEX "pagos_po_proveedorId_idx" ON "pagos_po"("proveedorId");

-- CreateIndex
CREATE INDEX "preguntas_requerimientoId_idx" ON "preguntas"("requerimientoId");

-- CreateIndex
CREATE INDEX "preguntas_proveedorId_idx" ON "preguntas"("proveedorId");

-- CreateIndex
CREATE INDEX "requerimientos_companyId_idx" ON "requerimientos"("companyId");

-- CreateIndex
CREATE INDEX "requerimientos_solicitanteId_idx" ON "requerimientos"("solicitanteId");
