import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restricts a route to one or more roles (full access). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const READONLY_ROLES_KEY = 'readonlyRoles';

/** Roles that may view a route but should be treated as read-only by handlers that check it. */
export const ReadonlyRoles = (...roles: Role[]) => SetMetadata(READONLY_ROLES_KEY, roles);
