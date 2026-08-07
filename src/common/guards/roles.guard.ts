import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY, READONLY_ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types';

/**
 * If a route has no @Roles()/@ReadonlyRoles() metadata, any authenticated
 * user of the right portal may access it. Otherwise the user's role must be
 * in one of the two lists; handlers can read `req.readonly` to branch logic
 * for roles that were granted view-only access.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const fullRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const readonlyRoles = this.reflector.getAllAndOverride<Role[]>(READONLY_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!fullRoles && !readonlyRoles) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (fullRoles?.includes(user.role)) {
      request.readonly = false;
      return true;
    }
    if (readonlyRoles?.includes(user.role)) {
      request.readonly = true;
      return true;
    }
    throw new ForbiddenException('Tu rol no tiene acceso a este recurso.');
  }
}
