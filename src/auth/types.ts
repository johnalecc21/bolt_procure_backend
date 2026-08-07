import { Portal, Role } from '@prisma/client';

/** Resolved by JwtAuthGuard (Supabase token + Prisma profile lookup) and attached to `req.user`. */
export interface AuthenticatedUser {
  sub: string; // userId (== Supabase auth.users.id)
  email: string;
  portal: Portal;
  role: Role;
  companyId: string;
}
