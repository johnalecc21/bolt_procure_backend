import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  EstadoDocumento,
  EstadoHomologacion,
  TipoArchivoVitrina,
} from '@prisma/client';
import { isEmail } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import {
  CrearArchivoVitrinaDto,
  ItemCatalogoDto,
  UpdateVitrinaDto,
  VitrinaUploadUrlDto,
} from './dto/vitrina.dto';
import {
  carpeta,
  extensionPermitida,
  EXTENSIONES_POR_USO,
  LIMITES,
  MAX_BYTES_ARCHIVO,
  urlSegura,
  VITRINA_BUCKET,
} from './vitrina.rules';

/** Trims; an empty string means "clear the field". */
function textoOpcional(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t ? t : null;
}

@Injectable()
export class VitrinaService implements OnModuleInit {
  private readonly logger = new Logger(VitrinaService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private proveedores: ProveedoresService,
  ) {}

  /** Creates the private bucket on first boot so nobody has to set it up by hand in Supabase. */
  onModuleInit() {
    this.storage
      .ensureBucket(VITRINA_BUCKET, {
        fileSizeLimit: MAX_BYTES_ARCHIVO,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
        ],
      })
      .then((ok) => {
        if (!ok)
          this.logger.warn(
            `No se pudo verificar/crear el bucket "${VITRINA_BUCKET}" en Supabase Storage.`,
          );
      })
      .catch((err: Error) =>
        this.logger.warn(`Bucket "${VITRINA_BUCKET}": ${err.message}`),
      );
  }

  // --- Lectura ------------------------------------------------------------

  /** Public, login-free showcase — only for proveedores with an approved homologación. */
  async publica(id: string) {
    const proveedor = await this.prisma.proveedorProfile.findFirst({
      where: { id, homologacion: { estado: EstadoHomologacion.APROBADO } },
      include: {
        homologacion: {
          select: {
            score: true,
            proximaRevalidacion: true,
            documentos: {
              where: { estado: EstadoDocumento.VALIDADO },
              select: { categoria: true, vigencia: true },
            },
          },
        },
      },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado.');

    const [contenido] = await Promise.all([
      this.contenido(proveedor.id),
      // Views are a signal for the proveedor, not an audit trail — no dedupe.
      this.prisma.proveedorProfile.update({
        where: { id },
        data: { vitrinaVistas: { increment: 1 } },
      }),
    ]);
    const ahora = new Date();
    const categoriasVerificadas = [
      ...new Set(
        proveedor
          .homologacion!.documentos.filter(
            (d) => !d.vigencia || d.vigencia > ahora,
          )
          .map((d) => d.categoria),
      ),
    ];
    return {
      id: proveedor.id,
      nombre: proveedor.nombre,
      iniciales: proveedor.iniciales,
      color: proveedor.color,
      categorias: proveedor.categorias,
      ubicacion: proveedor.ubicacion,
      sitioWeb: proveedor.sitioWeb,
      certificaciones: proveedor.certificaciones,
      score: proveedor.score,
      procesosGanados: proveedor.procesosGanados,
      entregasATiempo: proveedor.entregasATiempo,
      desempenoPromedio: proveedor.desempenoPromedio,
      evaluacionesCount: proveedor.evaluacionesCount,
      homologadoHasta: proveedor.homologacion!.proximaRevalidacion,
      categoriasVerificadas,
      miembroDesde: proveedor.createdAt,
      ...contenido,
    };
  }

  /** The proveedor's own view for editing — includes view count and whether it's publicly visible yet. */
  async mia(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id: proveedorId },
      include: { homologacion: { select: { estado: true } } },
    });
    return {
      id: proveedor.id,
      vitrinaVistas: proveedor.vitrinaVistas,
      publicada: proveedor.homologacion?.estado === EstadoHomologacion.APROBADO,
      ...(await this.contenido(proveedorId)),
    };
  }

  private async contenido(proveedorId: string) {
    const [proveedor, archivos, items] = await Promise.all([
      this.prisma.proveedorProfile.findUniqueOrThrow({
        where: { id: proveedorId },
        select: {
          descripcion: true,
          telefonoContacto: true,
          emailContacto: true,
          videoUrl: true,
          sitioWeb: true,
        },
      }),
      this.prisma.archivoVitrina.findMany({
        where: { proveedorId },
        orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.itemCatalogo.findMany({
        where: { proveedorId },
        orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const paths = [
      ...archivos.map((a) => a.storagePath),
      ...items.map((i) => i.imagenPath).filter((p): p is string => !!p),
    ];
    // A storage hiccup shouldn't take the whole vitrina down — files just show without a link.
    const urls = await this.storage
      .createDownloadUrls(VITRINA_BUCKET, paths)
      .catch((err: Error) => {
        this.logger.warn(
          `No se pudieron firmar los archivos de la vitrina ${proveedorId}: ${err.message}`,
        );
        return new Map<string, string | null>();
      });

    return {
      descripcion: proveedor.descripcion,
      telefonoContacto: proveedor.telefonoContacto,
      emailContacto: proveedor.emailContacto,
      videoUrl: proveedor.videoUrl,
      galeria: archivos
        .filter((a) => a.tipo === TipoArchivoVitrina.IMAGEN)
        .map((a) => ({
          id: a.id,
          titulo: a.titulo,
          url: urls.get(a.storagePath) ?? null,
        })),
      documentos: archivos
        .filter((a) => a.tipo !== TipoArchivoVitrina.IMAGEN)
        .map((a) => ({
          id: a.id,
          tipo: a.tipo,
          titulo: a.titulo,
          url: urls.get(a.storagePath) ?? null,
        })),
      catalogo: items.map((i) => ({
        id: i.id,
        nombre: i.nombre,
        descripcion: i.descripcion,
        categoria: i.categoria,
        unidad: i.unidad,
        precioReferencia: i.precioReferencia,
        moneda: i.moneda,
        imagenPath: i.imagenPath,
        imagenUrl: i.imagenPath ? (urls.get(i.imagenPath) ?? null) : null,
      })),
    };
  }

  // --- Datos generales ----------------------------------------------------

  async actualizar(userId: string, dto: UpdateVitrinaDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const emailContacto = textoOpcional(dto.emailContacto);
    const videoUrl = textoOpcional(dto.videoUrl);
    if (emailContacto && !isEmail(emailContacto))
      throw new BadRequestException('El correo de contacto no es válido.');
    if (videoUrl && !urlSegura(videoUrl))
      throw new BadRequestException(
        'El enlace del video debe empezar por https://',
      );

    await this.prisma.proveedorProfile.update({
      where: { id: proveedorId },
      data: {
        ...(dto.descripcion !== undefined
          ? { descripcion: textoOpcional(dto.descripcion) }
          : {}),
        ...(dto.telefonoContacto !== undefined
          ? { telefonoContacto: textoOpcional(dto.telefonoContacto) }
          : {}),
        ...(emailContacto !== undefined ? { emailContacto } : {}),
        ...(videoUrl !== undefined ? { videoUrl } : {}),
      },
    });
    return this.mia(userId);
  }

  // --- Archivos (galería, brochures, catálogos PDF) -----------------------

  async crearUrlSubida(userId: string, dto: VitrinaUploadUrlDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    if (!extensionPermitida(dto.uso, dto.filename)) {
      throw new BadRequestException(
        `Formato no permitido. Usa: ${EXTENSIONES_POR_USO[dto.uso].join(', ')}.`,
      );
    }
    if (dto.uso !== 'ITEM')
      await this.verificarLimiteArchivos(proveedorId, dto.uso);
    const path = `${carpeta(proveedorId, dto.uso)}${Date.now()}-${this.storage.safeFilename(dto.filename)}`;
    return this.storage.createUploadUrl(VITRINA_BUCKET, path);
  }

  async crearArchivo(userId: string, dto: CrearArchivoVitrinaDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    if (
      !dto.path.startsWith(carpeta(proveedorId, dto.tipo)) ||
      !extensionPermitida(dto.tipo, dto.path)
    ) {
      throw new BadRequestException('Ruta de archivo inválida.');
    }
    const existentes = await this.verificarLimiteArchivos(
      proveedorId,
      dto.tipo,
    );
    return this.prisma.archivoVitrina.create({
      data: {
        proveedorId,
        tipo: dto.tipo,
        titulo: dto.titulo.trim(),
        storagePath: dto.path,
        orden: existentes,
      },
    });
  }

  async eliminarArchivo(userId: string, id: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const archivo = await this.prisma.archivoVitrina.findFirst({
      where: { id, proveedorId },
    });
    if (!archivo) throw new NotFoundException('Archivo no encontrado.');
    await this.prisma.archivoVitrina.delete({ where: { id } });
    await this.storage
      .remove(VITRINA_BUCKET, [archivo.storagePath])
      .catch(() => undefined);
    return { ok: true };
  }

  private async verificarLimiteArchivos(
    proveedorId: string,
    tipo: TipoArchivoVitrina,
  ): Promise<number> {
    const existentes = await this.prisma.archivoVitrina.count({
      where: { proveedorId, tipo },
    });
    if (existentes >= LIMITES[tipo]) {
      throw new BadRequestException(
        `Alcanzaste el máximo de ${LIMITES[tipo]} archivos de este tipo. Elimina alguno primero.`,
      );
    }
    return existentes;
  }

  // --- Catálogo de productos / servicios ------------------------------------

  async crearItem(userId: string, dto: ItemCatalogoDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const existentes = await this.prisma.itemCatalogo.count({
      where: { proveedorId },
    });
    if (existentes >= LIMITES.ITEMS) {
      throw new BadRequestException(
        `Tu catálogo admite hasta ${LIMITES.ITEMS} productos o servicios.`,
      );
    }
    return this.prisma.itemCatalogo.create({
      data: {
        proveedorId,
        orden: existentes,
        ...this.datosItem(proveedorId, dto),
        nombre: dto.nombre.trim(),
      },
    });
  }

  async actualizarItem(userId: string, id: string, dto: ItemCatalogoDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const item = await this.prisma.itemCatalogo.findFirst({
      where: { id, proveedorId },
    });
    if (!item)
      throw new NotFoundException('Producto o servicio no encontrado.');
    const data = {
      ...this.datosItem(proveedorId, dto),
      nombre: dto.nombre.trim(),
    };
    const actualizado = await this.prisma.itemCatalogo.update({
      where: { id },
      data,
    });
    if (
      item.imagenPath &&
      data.imagenPath !== undefined &&
      data.imagenPath !== item.imagenPath
    ) {
      await this.storage
        .remove(VITRINA_BUCKET, [item.imagenPath])
        .catch(() => undefined);
    }
    return actualizado;
  }

  async eliminarItem(userId: string, id: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const item = await this.prisma.itemCatalogo.findFirst({
      where: { id, proveedorId },
    });
    if (!item)
      throw new NotFoundException('Producto o servicio no encontrado.');
    await this.prisma.itemCatalogo.delete({ where: { id } });
    if (item.imagenPath)
      await this.storage
        .remove(VITRINA_BUCKET, [item.imagenPath])
        .catch(() => undefined);
    return { ok: true };
  }

  private datosItem(proveedorId: string, dto: ItemCatalogoDto) {
    const imagenPath = textoOpcional(dto.imagenPath);
    if (
      imagenPath &&
      (!imagenPath.startsWith(carpeta(proveedorId, 'ITEM')) ||
        !extensionPermitida('ITEM', imagenPath))
    ) {
      throw new BadRequestException('Ruta de imagen inválida.');
    }
    if (dto.precioReferencia !== undefined && !dto.moneda) {
      throw new BadRequestException(
        'Indica la moneda del precio de referencia.',
      );
    }
    return {
      descripcion: textoOpcional(dto.descripcion) ?? null,
      categoria: textoOpcional(dto.categoria) ?? null,
      unidad: textoOpcional(dto.unidad) ?? null,
      precioReferencia: dto.precioReferencia ?? null,
      moneda: dto.precioReferencia !== undefined ? dto.moneda : null,
      ...(imagenPath !== undefined ? { imagenPath } : {}),
    };
  }
}
