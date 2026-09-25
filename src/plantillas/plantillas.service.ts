import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, TipoContrato, TipoPlantilla } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import { PdfConversor } from './pdf.conversor';
import { inspeccionar, llenar, plantillaEjemplo } from './plantillas.motor';
import {
  GRUPOS_MARCADORES,
  contextoEjemplo,
  dinero,
  fechaLarga,
  numero,
  valorEnLetras,
  type ContextoDocumento,
} from './plantillas.marcadores';
import type {
  ConfirmarPlantillaDto,
  MarcaDto,
  SubidaDto,
} from './dto/plantillas.dto';

const BUCKET = 'plantillas-documentos';
const BUCKET_CONTRATOS = 'contratos-documentos';
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

const ESTADO_LABEL: Record<string, string> = {
  ACTIVO: 'Activo',
  EN_RIESGO: 'En riesgo',
  POR_VENCER: 'Por vencer',
  VENCIDO: 'Vencido',
  TERMINADO: 'Terminado',
  COMPLETADO: 'Completado',
};

const TIPO_MODIFICACION: Record<string, string> = {
  PRORROGA: 'Prórroga',
  MONTO: 'Cambio de valor',
  TERMINACION: 'Terminación',
};

export const NOMBRE_TIPO: Record<TipoPlantilla, string> = {
  CONTRATO_MARCO: 'Contrato marco',
  ORDEN_COMPRA: 'Orden de compra',
};

/** Which kind of template a contract uses (addenda keep the Procurex one). */
export function tipoPlantilla(c: {
  tipo: TipoContrato;
  contratoPadreId: string | null;
}): TipoPlantilla | null {
  if (c.tipo === TipoContrato.PO) return TipoPlantilla.ORDEN_COMPRA;
  if (c.tipo === TipoContrato.CONTRATO && !c.contratoPadreId)
    return TipoPlantilla.CONTRATO_MARCO;
  return null;
}

/**
 * Company templates and letterhead. Templates are Word files with
 * {{placeholders}}; on signing a contract / issuing a PO the matching active
 * template is filled with the real data, converted to PDF and stored as the
 * contract's current document version.
 */
@Injectable()
export class PlantillasService implements OnModuleInit {
  private readonly logger = new Logger(PlantillasService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private auditLog: AuditLogService,
    private pdf: PdfConversor,
  ) {}

  onModuleInit() {
    this.storage
      .ensureBucket(BUCKET, {
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: [MIME_DOCX, ...MIME_LOGO],
      })
      .then(
        (ok) =>
          !ok &&
          this.logger.warn(`No se pudo verificar/crear el bucket "${BUCKET}".`),
      )
      .catch((err: Error) =>
        this.logger.warn(`Bucket "${BUCKET}": ${err.message}`),
      );
  }

  // ------------------------------------------------------------ plantillas

  async listar(companyId: string) {
    const plantillas = await this.prisma.plantillaDocumento.findMany({
      where: { companyId },
      orderBy: [{ tipo: 'asc' }, { createdAt: 'desc' }],
    });
    return {
      plantillas,
      marcadores: GRUPOS_MARCADORES,
      pdfDisponible: this.pdf.disponible,
    };
  }

  private async plantilla(companyId: string, id: string) {
    const p = await this.prisma.plantillaDocumento.findFirst({
      where: { id, companyId },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada.');
    return p;
  }

  async urlSubida(companyId: string, dto: SubidaDto) {
    if (!/\.docx$/i.test(dto.filename))
      throw new BadRequestException(
        'Sube la plantilla en formato Word (.docx).',
      );
    if (dto.tamanoBytes && dto.tamanoBytes > MAX_BYTES)
      throw new BadRequestException('La plantilla no puede pasar de 10 MB.');
    const path = `${companyId}/plantillas/${Date.now()}-${this.storage.safeFilename(dto.filename)}`;
    return this.storage.createUploadUrl(BUCKET, path);
  }

  /**
   * Validates the uploaded file. An invalid template is removed and the
   * reasons returned; a valid one is saved inactive until previewed.
   */
  async confirmar(
    companyId: string,
    dto: ConfirmarPlantillaDto,
    actor: string,
  ) {
    if (!dto.path.startsWith(`${companyId}/plantillas/`))
      throw new BadRequestException('Ruta de archivo inválida.');
    const archivo = await this.storage.descargar(BUCKET, dto.path);
    const r = inspeccionar(archivo);
    if (!r.ok) {
      await this.storage.remove(BUCKET, [dto.path]);
      throw new BadRequestException({
        message:
          'La plantilla tiene errores. Corrígelos en Word y súbela de nuevo.',
        errores: r.errores,
      });
    }
    const p = await this.prisma.plantillaDocumento.create({
      data: {
        companyId,
        tipo: dto.tipo,
        categoria: dto.categoria?.trim() || null,
        nombre: dto.nombre.trim(),
        archivoNombre: dto.archivoNombre,
        storagePath: dto.path,
        tamanoBytes: dto.tamanoBytes ?? archivo.length,
        marcadores: r.marcadores,
        advertencias: r.advertencias,
        subidaPor: actor,
      },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Plantilla de documento subida',
      detalle: `${NOMBRE_TIPO[p.tipo]} · ${p.nombre}${p.categoria ? ` (${p.categoria})` : ''}`,
    });
    return p;
  }

  /** One active template per kind and category: activating replaces the other. */
  async activar(companyId: string, id: string, activa: boolean, actor: string) {
    const p = await this.plantilla(companyId, id);
    await this.prisma.$transaction([
      ...(activa
        ? [
            this.prisma.plantillaDocumento.updateMany({
              where: {
                companyId,
                tipo: p.tipo,
                categoria: p.categoria,
                id: { not: p.id },
              },
              data: { activa: false },
            }),
          ]
        : []),
      this.prisma.plantillaDocumento.update({
        where: { id },
        data: { activa },
      }),
    ]);
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: activa ? 'Plantilla activada' : 'Plantilla desactivada',
      detalle: `${NOMBRE_TIPO[p.tipo]} · ${p.nombre}`,
    });
    return this.listar(companyId);
  }

  async eliminar(companyId: string, id: string, actor: string) {
    const p = await this.plantilla(companyId, id);
    await this.prisma.plantillaDocumento.delete({ where: { id } });
    await this.storage.remove(BUCKET, [p.storagePath]);
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Plantilla eliminada',
      detalle: `${NOMBRE_TIPO[p.tipo]} · ${p.nombre}`,
    });
    return { ok: true };
  }

  async urlDescarga(companyId: string, id: string) {
    const p = await this.plantilla(companyId, id);
    const { url } = await this.storage.createDownloadUrl(BUCKET, p.storagePath);
    return { url, nombre: p.archivoNombre };
  }

  ejemplo(tipo: TipoPlantilla) {
    return {
      contenido: plantillaEjemplo(tipo),
      nombre: `plantilla-${tipo === 'CONTRATO_MARCO' ? 'contrato-marco' : 'orden-de-compra'}.docx`,
      mime: MIME_DOCX,
    };
  }

  /**
   * The template filled with a real contract of that kind (the one given or
   * the latest), or with sample data when there is none yet.
   */
  async vistaPrevia(
    companyId: string,
    id: string,
    contratoId: string | undefined,
    formato: 'pdf' | 'docx' = 'pdf',
  ) {
    const p = await this.plantilla(companyId, id);
    const contrato = contratoId
      ? await this.prisma.contrato.findFirst({
          where: { id: contratoId, companyId },
          select: { id: true },
        })
      : await this.prisma.contrato.findFirst({
          where: {
            companyId,
            ...(p.tipo === TipoPlantilla.ORDEN_COMPRA
              ? { tipo: TipoContrato.PO }
              : { tipo: TipoContrato.CONTRATO, contratoPadreId: null }),
            ...(p.categoria ? { categoria: p.categoria } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
    if (contratoId && !contrato)
      throw new NotFoundException('Contrato no encontrado.');
    const datos = contrato
      ? await this.contexto(contrato.id)
      : await this.contextoDeEjemplo(companyId);
    const docx = llenar(
      await this.storage.descargar(BUCKET, p.storagePath),
      datos,
    );
    const base = `vista-previa-${p.nombre.replace(/[^\w-]+/g, '-').toLowerCase()}`;
    if (formato === 'pdf') {
      const pdf = await this.pdf.aPdf(docx, `${base}.docx`);
      if (pdf)
        return {
          contenido: pdf,
          nombre: `${base}.pdf`,
          mime: 'application/pdf',
          conDatosReales: !!contrato,
        };
    }
    return {
      contenido: docx,
      nombre: `${base}.docx`,
      mime: MIME_DOCX,
      conDatosReales: !!contrato,
    };
  }

  // --------------------------------------------------------------- contexto

  private async marcaDe(companyId: string) {
    const [company, marca] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { nombre: true },
      }),
      this.prisma.marcaDocumentos.findUnique({ where: { companyId } }),
    ]);
    const empresa = {
      razonSocial: marca?.razonSocial || company.nombre,
      nit: marca?.nit ?? '',
      direccion: marca?.direccion ?? '',
      ciudad: marca?.ciudad ?? '',
      telefono: marca?.telefono ?? '',
      email: marca?.email ?? '',
      representanteLegal: marca?.representanteLegal ?? '',
      cargoRepresentante: marca?.cargoRepresentante ?? '',
    };
    return { empresa, clausulas: marca?.clausulas ?? '' };
  }

  private async contextoDeEjemplo(
    companyId: string,
  ): Promise<ContextoDocumento> {
    const ejemplo = contextoEjemplo();
    const { empresa, clausulas } = await this.marcaDe(companyId);
    return {
      ...ejemplo,
      empresa: Object.fromEntries(
        Object.entries(empresa).map(([k, v]) => [k, v || ejemplo.empresa[k]]),
      ),
      clausulas: clausulas || ejemplo.clausulas,
    };
  }

  /** Everything a template can print about one contract, already formatted. */
  async contexto(contratoId: string): Promise<ContextoDocumento> {
    const c = await this.prisma.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      include: {
        proveedor: {
          include: { user: { select: { email: true } } },
        },
        requerimiento: {
          select: { numero: true, titulo: true, descripcion: true },
        },
        centroCosto: { select: { codigo: true, nombre: true } },
        padre: {
          select: {
            tipo: true,
            numero: true,
            adjudicacion: {
              select: { poId: true, plazoDias: true, garantiaMeses: true },
            },
          },
        },
        adjudicacion: {
          include: {
            lineas: { include: { item: true } },
          },
        },
        hitos: { orderBy: { orden: 'asc' } },
        modificaciones: { orderBy: { createdAt: 'asc' } },
      },
    });
    const { empresa, clausulas } = await this.marcaDe(c.companyId);
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    const adj = c.adjudicacion;
    const condiciones = adj ?? c.padre?.adjudicacion ?? null;
    const $ = (v: number) => dinero(v, c.moneda);
    const lineas = adj?.lineas.length
      ? [...adj.lineas]
          .sort((a, b) => a.item.orden - b.item.orden)
          .map((l, i) => ({
            numero: String(i + 1),
            descripcion: l.item.descripcion,
            especificacion: l.item.especificacion ?? '',
            cantidad: numero(l.cantidad),
            unidad: l.item.unidad,
            precioUnitario: $(l.precioUnitario),
            subtotal: $(l.subtotal),
          }))
      : [
          {
            numero: '1',
            descripcion: c.requerimiento?.titulo ?? c.categoria,
            especificacion: '',
            cantidad: '1',
            unidad: 'global',
            precioUnitario: $(c.monto),
            subtotal: $(c.monto),
          },
        ];
    const dias = Math.max(
      0,
      Math.round(
        (c.vigenciaFin.getTime() - c.vigenciaInicio.getTime()) / 86_400_000,
      ),
    );
    return {
      empresa,
      proveedor: {
        razonSocial: c.proveedor?.nombre ?? c.proveedorNombre,
        nit: c.proveedor?.nit ?? '',
        direccion: c.proveedor?.ubicacion ?? '',
        email: c.proveedor?.emailContacto ?? c.proveedor?.user?.email ?? '',
        telefono: c.proveedor?.telefonoContacto ?? '',
      },
      contrato: {
        codigo,
        numeroOrdenCompra: adj?.poId ?? codigo,
        tipo:
          tipoPlantilla(c) === TipoPlantilla.CONTRATO_MARCO
            ? 'Contrato marco'
            : c.tipo === TipoContrato.PO
              ? 'Orden de compra'
              : 'Otrosí',
        objeto: c.requerimiento?.titulo ?? c.categoria,
        descripcion: c.requerimiento?.descripcion ?? '',
        categoria: c.categoria,
        requerimiento: c.requerimiento
          ? formatRequerimientoCodigo(c.requerimiento.numero)
          : '',
        contratoMarco: c.padre
          ? formatContratoCodigo(c.padre.tipo, c.padre.numero)
          : '',
        centroCosto: c.centroCosto
          ? `${c.centroCosto.codigo} · ${c.centroCosto.nombre}`
          : '',
        fechaFirma: fechaLarga(c.createdAt),
        vigenciaInicio: fechaLarga(c.vigenciaInicio),
        vigenciaFin: fechaLarga(c.vigenciaFin),
        duracionDias: String(dias),
        moneda: c.moneda,
        valor: $(c.monto),
        valorEnLetras: valorEnLetras(c.monto, c.moneda),
        condicionesPagoDias: String(c.condicionesPagoDias),
        plazoEntregaDias: condiciones ? String(condiciones.plazoDias) : '',
        garantiaMeses: condiciones ? String(condiciones.garantiaMeses) : '',
        estado: ESTADO_LABEL[c.estado] ?? c.estado,
      },
      lineas,
      hitos: c.hitos.map((h, i) => ({
        numero: String(i + 1),
        descripcion: h.label,
        fecha: fechaLarga(h.comprometido),
        porcentaje: String(h.porcentaje),
        valor: $(Math.round((c.monto * h.porcentaje) / 100)),
      })),
      modificaciones: c.modificaciones.map((m) => ({
        fecha: fechaLarga(m.createdAt),
        tipo: TIPO_MODIFICACION[m.tipo] ?? m.tipo,
        detalle:
          m.tipo === 'PRORROGA'
            ? `Vigencia hasta el ${fechaLarga(m.vigenciaDespues)}`
            : m.tipo === 'MONTO'
              ? `Valor de ${$(m.montoAntes ?? 0)} a ${$(m.montoDespues ?? 0)}`
              : 'Terminación anticipada',
        motivo: m.motivo,
      })),
      clausulas,
      fechaGeneracion: fechaLarga(new Date()),
    };
  }

  // ------------------------------------------------------------ generación

  /** Most specific active template: the contract's category first. */
  private async plantillaPara(
    companyId: string,
    tipo: TipoPlantilla,
    categoria: string,
  ) {
    const activas = await this.prisma.plantillaDocumento.findMany({
      where: {
        companyId,
        tipo,
        activa: true,
        OR: [{ categoria }, { categoria: null }],
      },
    });
    return activas.find((p) => p.categoria === categoria) ?? activas[0] ?? null;
  }

  /**
   * Fills the active template for this contract and stores the result as a
   * new document version (PDF, plus the editable .docx). Null when the
   * company has no template for it.
   */
  async generar(companyId: string, contratoId: string, motivo: string) {
    const c = await this.prisma.contrato.findFirst({
      where: { id: contratoId, companyId },
      select: {
        id: true,
        tipo: true,
        numero: true,
        categoria: true,
        contratoPadreId: true,
      },
    });
    if (!c) throw new NotFoundException('Contrato no encontrado.');
    const tipo = tipoPlantilla(c);
    if (!tipo) return null;
    const plantilla = await this.plantillaPara(companyId, tipo, c.categoria);
    if (!plantilla) return null;

    const datos = await this.contexto(c.id);
    const docx = llenar(
      await this.storage.descargar(BUCKET, plantilla.storagePath),
      datos,
    );
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    const base = `${companyId}/${c.id}/${Date.now()}-${codigo}`;
    const rutaDocx = `${base}.docx`;
    await this.storage.subir(BUCKET_CONTRATOS, rutaDocx, docx, MIME_DOCX);
    const pdf = await this.pdf.aPdf(docx, `${codigo}.docx`);
    let principal = rutaDocx;
    let nombre = `${codigo}.docx`;
    let tamano = docx.length;
    if (pdf) {
      principal = `${base}.pdf`;
      nombre = `${codigo}.pdf`;
      tamano = pdf.length;
      await this.storage.subir(
        BUCKET_CONTRATOS,
        principal,
        pdf,
        'application/pdf',
      );
    }
    const [, version] = await this.prisma.$transaction([
      this.prisma.contrato.update({
        where: { id: c.id },
        data: {
          archivoStoragePath: principal,
          archivoNombre: nombre,
          archivoTamanoBytes: tamano,
        },
      }),
      this.prisma.versionDocumentoContrato.create({
        data: {
          contratoId: c.id,
          nombre,
          storagePath: principal,
          storagePathEditable: rutaDocx,
          tamanoBytes: tamano,
          origen: 'PLANTILLA',
          plantillaId: plantilla.id,
          subidoPor: `Plantilla "${plantilla.nombre}"`,
        },
      }),
    ]);
    await this.auditLog.log({
      companyId,
      usuario: 'Procurex',
      accion: 'Documento generado desde plantilla',
      detalle: `${codigo} — ${plantilla.nombre} (${motivo}${pdf ? ', PDF' : ', Word'})`,
    });
    return version;
  }

  /**
   * For signing / PO / amendment hooks: a template problem must never undo
   * the business action — it is logged and the default document remains.
   */
  async generarSilencioso(
    companyId: string,
    contratoId: string,
    motivo: string,
  ) {
    try {
      return await this.generar(companyId, contratoId, motivo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Plantilla para ${contratoId}: ${msg}`);
      await this.auditLog
        .log({
          companyId,
          usuario: 'Procurex',
          accion: 'No se pudo generar el documento desde plantilla',
          detalle: `${motivo}: ${msg}`.slice(0, 500),
        })
        .catch(() => undefined);
      return null;
    }
  }

  /** Whether this contract would be filled from a company template. */
  async hayPlantilla(
    companyId: string,
    c: {
      tipo: TipoContrato;
      contratoPadreId: string | null;
      categoria: string;
    },
  ) {
    const tipo = tipoPlantilla(c);
    return !!tipo && !!(await this.plantillaPara(companyId, tipo, c.categoria));
  }

  // ------------------------------------------------------------------ marca

  async obtenerMarca(companyId: string) {
    const [company, m] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { nombre: true },
      }),
      this.prisma.marcaDocumentos.findUnique({ where: { companyId } }),
    ]);
    let logoUrl: string | null = null;
    if (m?.logoPath) {
      try {
        logoUrl = (
          await this.storage.createDownloadUrl(BUCKET, m.logoPath, 3600)
        ).url;
      } catch {
        logoUrl = null;
      }
    }
    return {
      nombreEmpresa: company.nombre,
      razonSocial: m?.razonSocial ?? '',
      nit: m?.nit ?? '',
      direccion: m?.direccion ?? '',
      ciudad: m?.ciudad ?? '',
      telefono: m?.telefono ?? '',
      email: m?.email ?? '',
      sitioWeb: m?.sitioWeb ?? '',
      representanteLegal: m?.representanteLegal ?? '',
      cargoRepresentante: m?.cargoRepresentante ?? '',
      colorPrimario: m?.colorPrimario ?? '',
      clausulas: m?.clausulas ?? '',
      piePagina: m?.piePagina ?? '',
      tieneLogo: !!m?.logoPath,
      logoUrl,
    };
  }

  /** Letterhead for the Procurex PDF (both portals see it); null if never set. */
  async marcaParaPdf(companyId: string) {
    const m = await this.prisma.marcaDocumentos.findUnique({
      where: { companyId },
    });
    if (!m) return null;
    let logoUrl: string | null = null;
    if (m.logoPath) {
      try {
        logoUrl = (
          await this.storage.createDownloadUrl(BUCKET, m.logoPath, 3600)
        ).url;
      } catch {
        logoUrl = null;
      }
    }
    return {
      razonSocial: m.razonSocial,
      nit: m.nit,
      direccion: m.direccion,
      ciudad: m.ciudad,
      telefono: m.telefono,
      email: m.email,
      representanteLegal: m.representanteLegal,
      cargoRepresentante: m.cargoRepresentante,
      colorPrimario: m.colorPrimario,
      clausulas: m.clausulas,
      piePagina: m.piePagina,
      logoUrl,
    };
  }

  async guardarMarca(companyId: string, dto: MarcaDto, actor: string) {
    const data = Object.fromEntries(
      Object.entries(dto)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    ) as Prisma.MarcaDocumentosUncheckedCreateInput;
    await this.prisma.marcaDocumentos.upsert({
      where: { companyId },
      create: { ...data, companyId },
      update: data,
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Datos de documentos actualizados',
      detalle: Object.keys(data).join(', ') || 'sin cambios',
    });
    return this.obtenerMarca(companyId);
  }

  async urlSubidaLogo(companyId: string, dto: SubidaDto) {
    if (!/\.(png|jpe?g|webp)$/i.test(dto.filename))
      throw new BadRequestException('El logo debe ser PNG, JPG o WebP.');
    if (dto.tamanoBytes && dto.tamanoBytes > 2 * 1024 * 1024)
      throw new BadRequestException('El logo no puede pasar de 2 MB.');
    const path = `${companyId}/marca/${Date.now()}-${this.storage.safeFilename(dto.filename)}`;
    return this.storage.createUploadUrl(BUCKET, path);
  }

  async confirmarLogo(companyId: string, path: string | null, actor: string) {
    if (path && !path.startsWith(`${companyId}/marca/`))
      throw new BadRequestException('Ruta de archivo inválida.');
    const anterior = await this.prisma.marcaDocumentos.findUnique({
      where: { companyId },
      select: { logoPath: true },
    });
    await this.prisma.marcaDocumentos.upsert({
      where: { companyId },
      create: { companyId, logoPath: path },
      update: { logoPath: path },
    });
    if (anterior?.logoPath && anterior.logoPath !== path)
      await this.storage.remove(BUCKET, [anterior.logoPath]);
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: path
        ? 'Logo de documentos actualizado'
        : 'Logo de documentos quitado',
      detalle: '',
    });
    return this.obtenerMarca(companyId);
  }
}
