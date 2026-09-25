# Plantillas de contratos y órdenes de compra

Cada empresa puede usar **sus propios formatos** de orden de compra y de
contrato marco. Procurex los llena con los datos reales al firmar, los
convierte a PDF y los guarda como documento vigente del contrato. Si una
empresa no tiene plantilla, se usa el formato de Procurex con su marca
(logo, color, datos, cláusulas y firma).

Pantalla: **Cliente › Plantillas y documentos** (solo Admin Cliente).

## Cómo funciona

1. **Preparar el Word.** La empresa toma su formato actual (.docx) y
   reemplaza los datos variables por marcadores, por ejemplo
   `{{proveedor.nit}}` o `{{contrato.valor}}`. También puede descargar la
   plantilla de ejemplo, que ya trae encabezado, objeto, valor en letras,
   tabla de ítems, hitos, cláusulas y firmas.
2. **Subirlo.** Procurex lo valida y, si tiene errores, lo rechaza con un
   mensaje por cada uno:
   - marcadores mal escritos (`{{proveedor.nitt}}`);
   - llaves sin cerrar;
   - bloques `{{#lineas}}` sin su `{{/lineas}}`;
   - archivos que no son .docx.

   Si falta información clave, avisa sin bloquear: la razón social o el NIT
   del proveedor, el valor o el número del documento.
3. **Vista previa.** Genera el documento con el último contrato real de ese
   tipo, o con datos de ejemplo si todavía no hay ninguno, en PDF o en Word.
4. **Activarla.** Hay una plantilla activa por tipo de documento y por
   categoría. Una plantilla de categoría (por ejemplo "Solo Mantenimiento")
   tiene prioridad sobre la general.

## Cuándo se genera

| Evento | Plantilla | Resultado |
|---|---|---|
| Firmar una adjudicación que produce una PO | Orden de compra | Versión 1 del documento |
| Firmar una adjudicación que produce un contrato marco | Contrato marco | Versión 1 |
| Emitir una PO bajo un contrato marco | Orden de compra (`{{contrato.contratoMarco}}` trae el marco) | Versión 1 de la PO |
| Prórroga o cambio de valor | La misma | Versión nueva con los datos y la modificación |
| Botón **Generar desde plantilla** en la ficha del contrato | La activa | Versión nueva |

Cada versión generada guarda el **PDF**, que es el vigente y el que ve el
proveedor, y el **Word llenado**, que jurídica puede descargar y editar. Si
jurídica sube un documento firmado, este queda como la versión siguiente.

Un problema con la plantilla nunca bloquea la firma: queda registrado en la
auditoría ("No se pudo generar el documento desde plantilla") y se sigue
usando el formato de Procurex.

## Marcadores

La lista completa, con descripción y ejemplo, está en la pestaña **Guía de
marcadores** (sale de `src/plantillas/plantillas.marcadores.ts`). En resumen:

- `empresa.*`: razonSocial, nit, direccion, ciudad, telefono, email,
  representanteLegal, cargoRepresentante. Salen de la pestaña **Marca y
  datos**.
- `proveedor.*`: razonSocial, nit, direccion, email, telefono.
- `contrato.*`: codigo, numeroOrdenCompra, tipo, objeto, descripcion,
  categoria, requerimiento, contratoMarco, centroCosto, fechaFirma,
  vigenciaInicio, vigenciaFin, duracionDias, moneda, valor, valorEnLetras
  ("QUINCE MILLONES DE PESOS M/CTE"), condicionesPagoDias, plazoEntregaDias,
  garantiaMeses, estado.
- Tablas que se repiten: `{{#lineas}}…{{/lineas}}` (numero, descripcion,
  especificacion, cantidad, unidad, precioUnitario, subtotal),
  `{{#hitos}}…{{/hitos}}` (numero, descripcion, fecha, porcentaje, valor) y
  `{{#modificaciones}}…{{/modificaciones}}` (fecha, tipo, detalle, motivo).
  Para repetir una fila de tabla, el marcador de apertura va en la primera
  celda y el de cierre en la última.
- Condicionales: `{{#contrato.contratoMarco}}texto{{/contrato.contratoMarco}}`
  solo aparece si hay un valor.
- `{{clausulas}}` (las cláusulas de la empresa) y `{{fechaGeneracion}}`.

Las fechas salen en formato largo ("25 de septiembre de 2026") y los valores
con formato de moneda ("$ 15.000.000"). El formato de Word (negrita, tamaño,
color) aplicado al marcador se conserva en el valor.

## Técnica

- **Motor:** [docxtemplater](https://docxtemplater.com) con delimitadores
  `{{ }}` y rutas con punto (`src/plantillas/plantillas.motor.ts`). Word a
  veces parte un marcador en varios fragmentos al editar; docxtemplater lo
  resuelve.
- **PDF:** [Gotenberg](https://gotenberg.dev) (LibreOffice) en el
  `docker-compose` de Contabo (`GOTENBERG_URL=http://gotenberg:3000`). Sin
  él, el documento vigente es el Word llenado.
- **Almacenamiento:** las plantillas y el logo van en el bucket privado
  `plantillas-documentos`, que la API crea al arrancar. Los documentos
  generados van en `contratos-documentos`, junto a los que se suben a mano.
- **Modelos:** `PlantillaDocumento` (tipo, categoría, activa, marcadores y
  advertencias detectados), `MarcaDocumentos` (datos de la empresa, logo,
  color, cláusulas y pie de página) y, en `VersionDocumentoContrato`, los
  campos `origen` (MANUAL/PLANTILLA), `plantillaId` y `storagePathEditable`.
- **Endpoints (`/plantillas`, Admin Cliente):**
  - `GET /`
  - `GET /ejemplo?tipo=`
  - `POST /upload-url` y `POST /` para subir y validar
  - `PATCH /:id` para activar o desactivar
  - `DELETE /:id`
  - `GET /:id/url`
  - `GET /:id/vista-previa?formato=pdf|docx&contratoId=`
  - `GET|PUT /marca`
  - `POST /marca/logo/upload-url`, `PUT|DELETE /marca/logo`

  En contratos: `POST /contratos/:id/documento/regenerar` y
  `GET /contratos/:id/versiones/:versionId/url?editable=1` (el Word).
