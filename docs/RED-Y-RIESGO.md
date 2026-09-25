# Red de proveedores, tablero en vivo y riesgo continuo

Migración: `red_tablero_riesgo`.

## 1. Red de proveedores

La promesa al proveedor: homologarse una vez y participar en los procesos de todas las empresas de Procurex. El registro y la vitrina son gratis.

**Modelo:**
- `Requerimiento.abiertoRed` (boolean): se elige al crear el requerimiento (`abiertoRed` en `POST /requerimientos`).
- `Invitacion.origen`: `INVITACION` o `RED`.

**Publicación:** `RedService.publicar` se llama al aprobarse la salida a licitación (`AprobacionesService`), después de enviar las invitaciones directas.
- Avisa a los proveedores homologados que cumplan tres condiciones:
  - son de la categoría (comparación sin tildes ni mayúsculas);
  - son elegibles según los requisitos de documentos de la empresa (`esElegible`);
  - no estaban invitados.
- El tope es de 500 avisos.
- Nunca lanza error, así que no bloquea la aprobación.

**Endpoints (`/red`):**

| Método | Ruta | Quién | Qué |
|---|---|---|---|
| GET | `publico/proveedores?q=&categoria=&page=` | público | Directorio de homologados (24 por página) sin datos privados y con conteo por categoría |
| GET | `publico/estadisticas` | público | Homologados, empresas y convocatorias abiertas |
| GET | `oportunidades?todas=1&q=` | proveedor | Procesos abiertos (`EN_LICITACION`, `abiertoRed`, sin vencer). Cada uno dice `puedeParticipar` y el `motivo` si no puede |
| POST | `oportunidades/:id/participar` | proveedor | Crea la invitación con origen `RED` (o reactiva una declinada) y avisa al solicitante. 409 si ya participa |
| GET | `requerimientos/:id/tablero` | comprador, admin, CFO | Tablero en vivo |
| PATCH | `requerimientos/:id` `{abierto}` | comprador, admin | Abre o cierra el proceso a la red durante la licitación. Al abrirlo, publica |

Antes de unirse, el proveedor puede ver el requerimiento completo (`GET /invitaciones/requerimiento/:id`) aunque no tenga invitación, siempre que el proceso esté abierto a la red.

## 2. Tablero en vivo

Nuevas marcas de tiempo:
- `Invitacion.vistaAt`: primera vez que el proveedor abre el requerimiento.
- `Invitacion.respondidaAt`: cuando acepta o declina.
- `Oferta.updatedAt`: última edición del borrador.
- `Oferta.enviadaAt`: cuando envía. La migración rellena `enviadaAt = createdAt` en las ofertas ya enviadas.

Etapas: `SIN_ABRIR → VIO → ACEPTO → PREPARANDO → OFERTA_ENVIADA`, o `DECLINO`.
- El resumen trae el embudo, cuántos llegaron por la red y cuántas preguntas hubo.
- **Nunca incluye precios.**
- El frontend consulta cada 15 s mientras la licitación está abierta.

## 3. Riesgo continuo

`RiesgoService` corre todos los días a las 04:15 (cron `0 15 4 * * *`) con un lock en Redis (`riesgo:monitoreo:lock`). Compliance también puede dispararlo con `POST /riesgo/ejecutar`.

| Revisión | Regla |
|---|---|
| Documentos | Para proveedores `APROBADO` con documentos `VALIDADO`/`SUBIDO` con `vigencia`: avisa a 30, 15 y 7 días (`avisoVencimiento` evita repetir). Al vencer, el documento pasa a `VENCIDO`, se crea la alerta `DOCUMENTO_VENCIDO` y se avisa al proveedor |
| Listas restrictivas | Lotes de 50 proveedores `APROBADO` sin monitoreo en 30 días (`Homologacion.ultimoMonitoreo`). Se vuelven a consultar OFAC y ONU y se guarda `VerificacionLista` con verificadoPor "Monitoreo automático". Si alguna lista responde `NO_DISPONIBLE`, no se marca como monitoreado y se reintenta al día siguiente. Una **coincidencia nueva** pasa la homologación a `ZONA_GRIS`, crea la alerta `LISTA_RESTRICTIVA`, audita, avisa a `COMPLIANCE_OPS` y avisa a las empresas con contratos vigentes solo con "en revisión". Al proveedor no se le revela |
| Revalidación | `proximaRevalidacion` vencida y sin alerta abierta: se crea la alerta `REVALIDACION` y se avisa al proveedor |

El proveedor puede enviar `vigencia` (ISO) al subir un documento (`POST /homologacion/documentos/:id/subir`), y Compliance puede fijarla al validarlo.

**Cierre de alertas:**
- Compliance resuelve una alerta con una nota: `POST /riesgo/alertas/:id/resolver`.
- Validar de nuevo un documento cierra sus alertas.
- Aprobar de nuevo la homologación cierra todas.

**Consultas:**
- `GET /riesgo/alertas?estado=` (Compliance).
- `GET /riesgo/proveedores/:id` (cliente): último monitoreo, próxima revalidación y alertas abiertas. Las de listas se muestran como "En revisión de compliance.".
- `GET /riesgo/mias` (proveedor): solo documentos y revalidación.

**Pendiente:** datos financieros (RUES, centrales de riesgo como DataCrédito o TransUnion).
