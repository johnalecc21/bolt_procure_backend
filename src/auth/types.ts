import { Portal, Role } from '@prisma/client';

/** Shape encoded in the JWT and attached to `req.user` by JwtStrategy. */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  portal: Portal;
  role: Role;
  companyId: string;
}

export interface AuthenticatedUser extends JwtPayload {}
