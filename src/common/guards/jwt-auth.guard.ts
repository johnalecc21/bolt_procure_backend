import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types';

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

    const { data, error } = await this.supabase.anon.auth.getUser(token);
    if (error || !data.user) {
      if (isPublic) return true;
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    const profile = await this.prisma.user.findUnique({ where: { id: data.user.id } });
    if (!profile || !profile.activo) {
      if (isPublic) return true;
      throw new UnauthorizedException('Usuario no encontrado o inactivo.');
    }

    const companyId = await this.resolveCompanyId(request, profile.id);

    (request as Request & { user: AuthenticatedUser }).user = {
      sub: profile.id,
      email: profile.email,
      portal: profile.portal,
      role: profile.role,
      companyId,
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }

  private async resolveCompanyId(request: Request, userId: string): Promise<string> {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { userId, activo: true },
      select: { companyId: true },
    });
    if (memberships.length === 0) {
      throw new UnauthorizedException('El usuario no tiene una empresa activa.');
    }
    const requested = request.headers['x-company-id'];
    const requestedId = Array.isArray(requested) ? requested[0] : requested;
    if (requestedId && memberships.some((m) => m.companyId === requestedId)) {
      return requestedId;
    }
    return memberships[0].companyId;
  }
}
