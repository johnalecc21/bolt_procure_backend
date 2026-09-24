import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { PrismaService } from '../../prisma/prisma.service';

function tokenExpiringIn(seconds: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString('base64url');
  return `h.${payload}.s`;
}

function contextFor(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard', () => {
  const getUser = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.co', portal: 'cliente', role: 'comprador', activo: true });
    findMany.mockResolvedValue([{ companyId: 'c1' }, { companyId: 'c2' }]);
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const supabase = { anon: { auth: { getUser } } } as unknown as SupabaseService;
    const prisma = { user: { findUnique }, companyMembership: { findMany } } as unknown as PrismaService;
    guard = new JwtAuthGuard(reflector, supabase, prisma);
  });

  it('verifica el token una sola vez y reutiliza la identidad en llamadas seguidas', async () => {
    const token = tokenExpiringIn(3600);
    for (let i = 0; i < 3; i++) {
      const { ctx, request } = contextFor({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user).toMatchObject({ sub: 'u1', companyId: 'c1' });
    }
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('respeta x-company-id solo si es una membresía real', async () => {
    const token = tokenExpiringIn(3600);
    const ok = contextFor({ authorization: `Bearer ${token}`, 'x-company-id': 'c2' });
    await guard.canActivate(ok.ctx);
    expect(ok.request.user).toMatchObject({ companyId: 'c2' });

    const ajena = contextFor({ authorization: `Bearer ${token}`, 'x-company-id': 'otra' });
    await guard.canActivate(ajena.ctx);
    expect(ajena.request.user).toMatchObject({ companyId: 'c1' });
  });

  it('no cachea tokens vencidos ni rechazados', async () => {
    const vencido = tokenExpiringIn(-10);
    await guard.canActivate(contextFor({ authorization: `Bearer ${vencido}` }).ctx);
    await guard.canActivate(contextFor({ authorization: `Bearer ${vencido}` }).ctx);
    expect(getUser).toHaveBeenCalledTimes(2);

    getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    const malo = contextFor({ authorization: `Bearer ${tokenExpiringIn(3600)}x` });
    await expect(guard.canActivate(malo.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza usuarios inactivos', async () => {
    findUnique.mockResolvedValue({ id: 'u1', activo: false });
    const { ctx } = contextFor({ authorization: `Bearer ${tokenExpiringIn(3600)}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
