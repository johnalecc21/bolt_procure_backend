import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Portal, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import type { JwtPayload } from './types';

const DEMO_2FA_CODE = '000000';
const MAX_ATTEMPTS = 5;
const PENDING_TOKEN_TTL = '10m';

@Injectable()
export class AuthService {
  /** In-memory lockout tracker (per `portal:email`) — resets on server restart, same tolerance as the rest of the demo backend. */
  private failedAttempts = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private userPublic(user: {
    id: string;
    nombre: string;
    email: string;
    portal: Portal;
    role: Role;
    iniciales: string;
    cargo: string | null;
    requires2FA: boolean;
  }) {
    const { id, nombre, email, portal, role, iniciales, cargo, requires2FA } = user;
    return { id, nombre, email, portal, role, iniciales, cargo, requires2FA };
  }

  private async companiesForUser(userId: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { userId, activo: true },
      include: { company: true },
    });
    return memberships.map((m) => ({ id: m.company.id, nombre: m.company.nombre }));
  }

  private signAccessToken(payload: JwtPayload) {
    return this.jwt.sign(
      { ...payload, type: 'access' },
      { expiresIn: this.config.get('JWT_EXPIRES_IN', '8h') },
    );
  }

  private signPendingToken(userId: string, stage: '2fa' | 'select-company') {
    return this.jwt.sign({ sub: userId, stage, type: 'pending' }, { expiresIn: PENDING_TOKEN_TTL });
  }

  private verifyPendingToken(token: string, expectedStage: '2fa' | 'select-company') {
    let payload: { sub: string; stage: string; type: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('El enlace de verificación expiró. Vuelve a iniciar sesión.');
    }
    if (payload.type !== 'pending' || payload.stage !== expectedStage) {
      throw new UnauthorizedException('Token inválido para este paso.');
    }
    return payload.sub;
  }

  private async finalizeLogin(userId: string, companyId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const companies = await this.companiesForUser(userId);
    const activeCompany = companyId
      ? companies.find((c) => c.id === companyId)
      : companies[0];
    if (!activeCompany) {
      throw new UnauthorizedException('El usuario no tiene una empresa activa.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

    const accessToken = this.signAccessToken({
      sub: user.id,
      email: user.email,
      portal: user.portal,
      role: user.role,
      companyId: activeCompany.id,
    });

    return {
      status: 'success' as const,
      accessToken,
      user: this.userPublic(user),
      activeCompany,
      companies,
    };
  }

  async login(dto: LoginDto) {
    const key = `${dto.portal}:${dto.email.toLowerCase()}`;
    const attempts = this.failedAttempts.get(key) ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      return { status: 'locked' as const };
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const passwordOk = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;

    if (!user || user.portal !== dto.portal || !passwordOk || !user.activo) {
      const next = attempts + 1;
      this.failedAttempts.set(key, next);
      return { status: 'invalid' as const, attemptsLeft: Math.max(0, MAX_ATTEMPTS - next) };
    }
    this.failedAttempts.delete(key);

    if (user.requires2FA) {
      return {
        status: '2fa_required' as const,
        pendingToken: this.signPendingToken(user.id, '2fa'),
        user: { nombre: user.nombre, email: user.email },
      };
    }

    const companies = await this.companiesForUser(user.id);
    if (companies.length > 1) {
      return {
        status: 'select_company' as const,
        pendingToken: this.signPendingToken(user.id, 'select-company'),
        companies,
      };
    }

    return this.finalizeLogin(user.id);
  }

  async verify2FA(pendingToken: string, code: string) {
    const userId = this.verifyPendingToken(pendingToken, '2fa');
    if (code !== DEMO_2FA_CODE) {
      throw new UnauthorizedException('Código incorrecto. Usa el código de demo (000000).');
    }
    const companies = await this.companiesForUser(userId);
    if (companies.length > 1) {
      return {
        status: 'select_company' as const,
        pendingToken: this.signPendingToken(userId, 'select-company'),
        companies,
      };
    }
    return this.finalizeLogin(userId);
  }

  async selectCompany(pendingToken: string, companyId: string) {
    const userId = this.verifyPendingToken(pendingToken, 'select-company');
    return this.finalizeLogin(userId, companyId);
  }

  async switchCompany(userId: string, companyId: string) {
    return this.finalizeLogin(userId, companyId);
  }

  async me(userId: string, companyId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
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

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const iniciales =
      dto.razonSocial
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || 'PV';
    const palette = [
      'oklch(0.60 0.22 280)',
      'oklch(0.60 0.18 155)',
      'oklch(0.70 0.18 68)',
      'oklch(0.65 0.20 200)',
    ];

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { nombre: dto.razonSocial.trim() } });
      const user = await tx.user.create({
        data: {
          nombre: dto.razonSocial.trim(),
          email: dto.email.toLowerCase(),
          passwordHash,
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
  }
}
