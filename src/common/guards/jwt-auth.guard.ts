import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types';
import { TtlCache } from '../utils/ttl-cache';

interface CachedIdentity {
  userId: string;
  email: string;
  portal: AuthenticatedUser['portal'];
  role: AuthenticatedUser['role'];
  companyIds: string[];
}

/**
 * How long a verified token's identity is reused. Every API call used to pay a
 * round trip to Supabase Auth plus two DB queries before doing any work; the
 * SPA fires several calls per screen, so this was most of the perceived
 * latency. The trade-off: deactivating a user, changing their role or a
 * logout elsewhere takes up to this long to be enforced on an already-issued
 * token.
 */
const IDENTITY_TTL_MS = 30_000;

/**
 * Replaces the old passport-jwt strategy: instead of locally verifying a
 * self-issued JWT, we validate the bearer token against Supabase Auth
 * (auth.getUser) and load our app-specific profile (portal/role/company)
 * from Prisma. `x-company-id` lets a multi-company user pick which company
 * the request acts as; it's validated against real memberships below.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabase: SupabaseService,
    private prisma: PrismaService,
  ) {}

  private readonly identities = new TtlCache<CachedIdentity>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Falta el token de autenticación.');
    }

    const identity = await this.resolveIdentity(token);
    if (!identity) {
      if (isPublic) return true;
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }
    if (identity.companyIds.length === 0) {
      throw new UnauthorizedException(
        'El usuario no tiene una empresa activa.',
      );
    }

    (request as Request & { user: AuthenticatedUser }).user = {
      sub: identity.userId,
      email: identity.email,
      portal: identity.portal,
      role: identity.role,
      companyId: this.pickCompany(request, identity.companyIds),
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }

  /** null = token rejected by Supabase, or no active profile behind it. */
  private async resolveIdentity(token: string): Promise<CachedIdentity | null> {
    const key = createHash('sha256').update(token).digest('base64url');
    const cached = this.identities.get(key);
    if (cached) return cached;

    const { data, error } = await this.supabase.anon.auth.getUser(token);
    if (error || !data.user) return null;

    const [profile, memberships] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: data.user.id } }),
      this.prisma.companyMembership.findMany({
        where: { userId: data.user.id, activo: true },
        select: { companyId: true },
      }),
    ]);
    if (!profile || !profile.activo) return null;

    const identity: CachedIdentity = {
      userId: profile.id,
      email: profile.email,
      portal: profile.portal,
      role: profile.role,
      companyIds: memberships.map((m) => m.companyId),
    };
    // Never cache past the token's own expiry.
    const expiresAtMs = this.tokenExpiryMs(token);
    const ttl = Math.min(
      IDENTITY_TTL_MS,
      expiresAtMs ? expiresAtMs - Date.now() : IDENTITY_TTL_MS,
    );
    this.identities.set(key, identity, ttl);
    return identity;
  }

  private tokenExpiryMs(token: string): number | null {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as { exp?: number };
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  /** `x-company-id` lets a multi-company user choose; only real memberships are honored. */
  private pickCompany(request: Request, companyIds: string[]): string {
    const requested = request.headers['x-company-id'];
    const requestedId = Array.isArray(requested) ? requested[0] : requested;
    return requestedId && companyIds.includes(requestedId)
      ? requestedId
      : companyIds[0];
  }
}
