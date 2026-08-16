import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Portal } from '@prisma/client';
import { PORTAL_KEY } from '../decorators/portal.decorator';
import type { AuthenticatedUser } from '../../auth/types';

@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const portals = this.reflector.getAllAndOverride<Portal[]>(PORTAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!portals || portals.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    if (!portals.includes(user?.portal)) {
      throw new ForbiddenException('Este recurso pertenece a otro portal.');
    }
    return true;
  }
}
