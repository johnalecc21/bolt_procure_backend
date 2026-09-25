# Integración con ERP

Procurex se conecta con **cualquier ERP** (Siigo, Alegra, World Office, SAP,
Oracle, NetSuite…) sin un conector específico, de dos maneras, y además tiene
un conector nativo para **Siigo Nube**:

| Modo | Para quién | Cómo |
|---|---|---|
| **Archivo** | Cualquier ERP, sin TI | Descargas un Excel/CSV con columnas fijas y lo importas en el ERP. |
| **Webhook** | Empresas con TI o un integrador (Make, n8n, Zapier, Power Automate, middleware propio) | Procurex envía cada documento firmado a una URL; el ERP informa los pagos por API. |
| **Siigo Nube** | Empresas que llevan la contabilidad en Siigo | Procurex crea terceros, facturas de compra y egresos por la API de Siigo, y lee los pagos hechos allá. Ver [Conector nativo: Siigo Nube](#conector-nativo-siigo-nube). |

Se configura en **Cliente → Integraciones ERP** (Admin o CFO).

## Qué se sincroniza

| Documento | Cuándo | Dirección |
|---|---|---|
| `PROVEEDOR` (tercero) | Antes de su primera orden | Procurex → ERP |
| `ORDEN_COMPRA` | Firma del contrato, PO bajo un marco, prórroga, cambio de valor, terminación (`anulada: true`) | Procurex → ERP |
| `RECEPCION` | El comprador recibe un hito | Procurex → ERP |
| `FACTURA` | Finanzas aprueba la factura del proveedor | Procurex → ERP |
| `PAGO` | Finanzas registra el pago **en Procurex** | Procurex → ERP |
| Pago hecho en el ERP | Tesorería paga | ERP → Procurex (API) |

Cada documento se envía como una **foto completa** (no como un cambio), con un
`version` que sube cuando el documento cambia. El receptor debe hacer
**upsert por `(tipo, entidadId)`** y quedarse con la versión más alta: así los
reintentos y las re-entregas nunca duplican nada.

## Mapeos

En la pestaña *Mapeos* se asigna a cada **centro de costo** su código en el ERP y
a cada **categoría** su cuenta contable. Viajan en `centroCosto.codigoErp`,
`categoria.cuentaErp` (órdenes) y `centroCostoErp` / `cuentaErp` (facturas).
El proveedor se identifica por su **NIT** (el proveedor lo registra en *Perfil
de empresa*; al migrar se tomó el detectado por OCR en la homologación).

> Impuestos (IVA, retenciones, ICA): se recomienda que los calcule el ERP con
> su parametrización tributaria. Procurex envía la base.

## Modo archivo

- **Exportar período**: todo lo firmado, recibido, aprobado y pagado en un rango
  de fechas, esté o no activa la integración.
- **Pendientes**: lo que se generó desde la última exportación; después de
  descargarlo se marca como exportado.

Hojas (y columnas estables) del Excel; cada hoja también se descarga como CSV:

- `Terceros`: id_procurex, nit, razon_social, email, telefono, ubicacion
- `Ordenes`: id_procurex, codigo, numero_oc, tipo, estado, anulada, contrato_marco, requerimiento, nit_proveedor, proveedor, fecha_firma, vigencia_inicio, vigencia_fin, moneda, valor_total, dias_pago, centro_costo, centro_costo_erp, categoria, cuenta_erp
- `Lineas`: codigo_orden, linea, descripcion, cantidad, unidad, precio_unitario, subtotal, moneda
- `Recepciones`: id_procurex, codigo_orden, nit_proveedor, descripcion, fecha_comprometida, fecha_recepcion, porcentaje, moneda, valor_liberado
- `Facturas`: id_procurex, numero_factura, nit_proveedor, proveedor, codigo_orden, concepto, fecha_emision, fecha_radicacion, fecha_aprobacion, fecha_vencimiento, moneda, valor, descuento_pronto_pago, valor_a_pagar, centro_costo_erp, cuenta_erp, id_pago
- `Pagos`: id_procurex, codigo_orden, numero_factura, nit_proveedor, proveedor, moneda, valor_pagado, fecha_pago, referencia

## Modo webhook

### Entrega

`POST` a la URL configurada (HTTPS, dirección pública), un documento por
petición, tiempo máximo 10 s, sin seguir redirecciones:

```http
POST /procurex HTTP/1.1
Content-Type: application/json
X-Procurex-Evento: ORDEN_COMPRA
X-Procurex-Entrega: cm1abc…:2          # id del evento : versión
X-Procurex-Timestamp: 1790380800
X-Procurex-Firma: sha256=5f1c…
```

```json
{
  "id": "cm1abc…",
  "tipo": "ORDEN_COMPRA",
  "version": 2,
  "entidadId": "cm0xyz…",
  "referencia": "PO-0007",
  "empresa": { "id": "…", "nombre": "Acme SAS" },
  "ocurrido": "2026-09-25T15:04:05.000Z",
  "datos": {
    "codigo": "PO-0007",
    "numeroOrdenCompra": "PO-2026-0012",
    "tipo": "PO",
    "anulada": false,
    "proveedor": { "id": "…", "nit": "900123456-7", "razonSocial": "Montajes SAS" },
    "moneda": "COP",
    "valorTotal": 15000000,
    "condicionesPagoDias": 30,
    "centroCosto": { "codigo": "MTO", "nombre": "Mantenimiento", "codigoErp": "CC-1105" },
    "categoria": { "nombre": "Mantenimiento", "cuentaErp": "514505" },
    "lineas": [{ "linea": 1, "descripcion": "Rodamiento", "cantidad": 10, "unidad": "und", "precioUnitario": 1500000, "subtotal": 15000000 }],
    "hitos": [{ "descripcion": "Entrega", "fechaComprometida": "2026-10-05", "porcentaje": 40, "valor": 6000000 }]
  }
}
```

**Respuesta**: cualquier `2xx` confirma la entrega. Si el cuerpo es JSON con
`idExterno` (o `id`), Procurex lo guarda y lo muestra junto al documento (p. ej.
el número de la orden en el ERP).

### Verificar la firma

La firma es `HMAC-SHA256(secreto, "<timestamp>.<cuerpo crudo>")` en hexadecimal.
Rechaza la petición si no coincide o si el timestamp tiene más de 5 minutos.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function firmaValida(secreto, timestamp, cuerpoCrudo, firma) {
  const esperada = 'sha256=' + createHmac('sha256', secreto).update(`${timestamp}.${cuerpoCrudo}`).digest('hex');
  const a = Buffer.from(esperada), b = Buffer.from(firma ?? '');
  return a.length === b.length && timingSafeEqual(a, b)
    && Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
}
```

### Reintentos

Si la URL no responde `2xx`: reintentos a los 1, 5, 30 minutos, 2 h, 12 h y
24 h. Después queda **Fallido** y se puede reintentar a mano (se reconstruye con
los datos actuales, por ejemplo tras corregir un mapeo) o descartar, desde la
pestaña *Sincronización*. El envío corre cada 30 s.

## API de entrada (ERP → Procurex)

Autenticación con la **API key** que se genera en *Conexión* (se muestra una sola
vez): `Authorization: Bearer pcx_…` o `X-Api-Key: pcx_…`.

### Informar un pago

```http
POST /integraciones/erp/entrada/pagos
{ "pagoId": "cm…", "fechaPago": "2026-10-20", "referencia": "EGR-5501" }
```

o, sin el id de Procurex, por número de factura (y NIT si puede repetirse):

```json
{ "numeroFactura": "FE-77", "nitProveedor": "900123456-7", "fechaPago": "2026-10-20", "referencia": "EGR-5501" }
```

Aplica las mismas reglas que finanzas en pantalla (factura aprobada, no dos
veces), notifica al proveedor y queda en la auditoría como
"ERP (integración)". Es idempotente: si ya estaba pagado responde
`{ "ok": true, "yaRegistrado": true }`.

### Acuse con el número del ERP

Para ERPs que procesan después (o en modo archivo):

```http
POST /integraciones/erp/entrada/acuse
{ "eventoId": "cm1abc…", "idExterno": "OC-4500123" }
```

## Conector nativo: Siigo Nube

Con el modo **Siigo Nube** Procurex escribe directamente en la contabilidad de la empresa, a través de la API pública de Siigo (`https://api.siigo.com`), sin archivos ni middleware.

| Procurex | Siigo | Cuándo |
|---|---|---|
| Proveedor | Tercero (`/v1/customers`, tipo *Supplier*, NIT con DV) | Al firmar su primera orden, o antes de su primera factura |
| Factura aprobada | Factura de compra FC (`/v1/purchases`) que queda como cuenta por pagar | Al aprobar la factura |
| Pago registrado en Procurex | Comprobante de egreso RP (`/v1/payment-receipts`, *DebtPayment*) contra la cuota de esa FC | Al registrar el pago |
| Factura saldada en Siigo | Pago marcado como PAGADO en Procurex (`pagadoPor = "Siigo (integración)"`) | Cada 10 min, o con **Leer pagos ahora** |

Siigo no tiene API de órdenes de compra ni de recepciones: en este modo esos documentos no se encolan (siguen en la exportación a Excel).

### Configuración (Integración ERP › Conexión › Siigo Nube)

1. **Credenciales**: usuario y *access key* de la API de Siigo (los genera el administrador de la cuenta Siigo). La key se guarda cifrada (AES-256-GCM) y nunca se devuelve.
2. **Probar y cargar catálogos**: lee de la propia cuenta de Siigo los comprobantes FC y RP, las formas de pago, los centros de costo, los IVA y los descuentos del RP.
3. **Cómo se registra**:
   - comprobante FC y forma de pago (normalmente *crédito proveedores*: la factura queda como cuenta por pagar, con el vencimiento pactado);
   - cuenta contable por defecto (auxiliar del PUC), usada cuando la categoría no tiene cuenta en **Mapeos**;
   - IVA opcional: el valor facturado se toma con IVA incluido (`tax_included`) y Siigo lo discrimina;
   - departamento y ciudad (códigos DANE) y responsabilidad fiscal, que solo se usan al crear terceros nuevos.
4. **Pagos**, una de dos opciones:
   - *Los registro en Procurex*: elige el comprobante RP y el banco o caja. Opcionalmente, el concepto de descuento para el pronto pago; sin él, un pago con descuento deja ese saldo abierto en Siigo.
   - *Los hago en Siigo*: Procurex no envía egresos y marca como pagada cada factura que Siigo muestre sin saldo.
5. **Mapeos**: el centro de costo va con su **código en Siigo** (debe existir allá) y la categoría con su **cuenta contable**.

### Reglas de envío

- **Terceros**: se buscan por NIT antes de crear, y un tercero existente no se modifica. El dígito de verificación se recalcula con el algoritmo de la DIAN. NIT que empieza por 8 o 9 → persona jurídica; si no, persona natural con NIT.
- **Número de la factura del proveedor**: se separa en prefijo y número (`FE-1234` → `FE` / `1234`). Si no tiene prefijo se usa `SP`.
- **Sin duplicados**: cada documento lleva en *observaciones* la marca `[procurex:factura:<id>]` o `[procurex:pago:<id>]`. Antes de crear, Procurex busca esa marca en lo creado desde que se encoló el evento. Si Siigo creó el documento pero la respuesta se perdió (timeout, 5xx), el reintento lo encuentra en vez de duplicarlo.
- **Orden**: el egreso espera a que su factura esté en Siigo. Si la factura se aprobó antes de activar la integración, se encola automáticamente.
- **Límites**: las llamadas se espacian (~90 por minuto por empresa) por debajo del límite de Siigo de 100 por minuto. Un 429 queda como error y se reintenta con la espera normal.
- **Resultado**: en Sincronización, la columna "En el ERP" muestra el número de Siigo (`FC-1-73`, `RP-1-10`). La ficha del contrato y Cuentas por Pagar también lo muestran.

### Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `SIIGO_API_URL` | `https://api.siigo.com` | Cambiarla solo para pruebas o sandbox |
| `SIIGO_PARTNER_ID` | `Procurex` | Nombre de la aplicación que Siigo exige en la cabecera `Partner-Id` |

> Antes del primer cliente real: probar en una cuenta sandbox de Siigo un ciclo completo (tercero → FC → RP). Hay que confirmar la forma de pago de la FC y el prefijo de la cuota que devuelve `/v1/accounts-payable`. Todo el flujo está probado contra una API simulada que valida las mismas reglas, pero no contra Siigo real.

## Seguridad

- La URL del webhook debe ser HTTPS y resolver a direcciones públicas (se
  vuelve a comprobar en cada envío), para que no pueda usarse contra la red
  interna del servidor.
- El secreto de firma se guarda cifrado (AES-256-GCM) con `INTEGRACIONES_SECRET`
  (o una clave derivada de `SUPABASE_SERVICE_ROLE_KEY`). La API key se guarda
  solo como hash. Ambos se pueden regenerar; el anterior deja de funcionar.
- Cada cambio de configuración, regeneración de credenciales, exportación y
  descarte queda en la auditoría.
