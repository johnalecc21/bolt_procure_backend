import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import { Portal, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
  ) {}

  private userPublic(user: {
    id: string;
    nombre: string;
    email: string;
    portal: Portal;
    role: Role;
    iniciales: string;
    cargo: string | null;
  }) {
    const { id, nombre, email, portal, role, iniciales, cargo } = user;
    return { id, nombre, email, portal, role, iniciales, cargo };
  }

  private async companiesForUser(userId: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { userId, activo: true },
      include: { company: true },
    });
    return memberships.map((m) => ({ id: m.company.id, nombre: m.company.nombre }));
  }

  /**
   * Login/2FA/session are now handled entirely by Supabase Auth on the frontend
   * (supabase-js). This is called right after a successful Supabase sign-in to
   * load our app-specific profile: portal, role, and company memberships.
   */
  async me(userId: string, companyId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const companies = await this.companiesForUser(userId);
    const activeCompany = companies.find((c) => c.id === companyId) ?? companies[0];
    return { user: this.userPublic(user), activeCompany, companies };
  }

  async registerProveedor(dto: RegisterProveedorDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con este correo.');
    }
    if (dto.razonSocial.trim().length < 2) {
      throw new BadRequestException('Razón social inválida.');
    }

    const { data, error } = await this.supabase.admin.auth.admin.createUser({
      email: dto.email.toLowerCase(),
      password: dto.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new ConflictException(error?.message ?? 'No se pudo crear la cuenta.');
    }

    const iniciales =
      dto.razonSocial
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || 'PV';
    const palette = [
      'oklch(0.46 0.14 246)',
      'oklch(0.60 0.18 155)',
      'oklch(0.70 0.18 68)',
      'oklch(0.65 0.20 200)',
    ];

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({ data: { nombre: dto.razonSocial.trim() } });
        const user = await tx.user.create({
          data: {
            id: data.user!.id,
            nombre: dto.razonSocial.trim(),
            email: dto.email.toLowerCase(),
            portal: Portal.PROVEEDOR,
            role: Role.PROVEEDOR,
            iniciales,
            cargo: 'Representante de la empresa',
          },
        });
        await tx.companyMembership.create({ data: { userId: user.id, companyId: company.id } });
        const proveedor = await tx.proveedorProfile.create({
          data: {
            userId: user.id,
            nombre: dto.razonSocial.trim(),
            iniciales,
            categorias: [dto.categoria],
            ubicacion: dto.pais,
            certificaciones: [],
            color: palette[Math.floor(Math.random() * palette.length)],
          },
        });
        await tx.homologacion.create({
          data: {
            proveedorId: proveedor.id,
            documentos: {
              create: [
                { nombre: 'RUT / NIT' },
                { nombre: 'Estados financieros' },
                { nombre: 'Certificado ISO / BASC / ESG' },
                { nombre: 'Referencias comerciales' },
              ],
            },
          },
        });
        return user;
      });

      return { id: result.id, email: result.email };
    } catch (err) {
      // Roll back the Supabase auth user if the Prisma profile transaction failed.
      await this.supabase.admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw err;
    }
  }
}
