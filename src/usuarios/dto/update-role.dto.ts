import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';

const CLIENTE_ROLES = [Role.COMPRADOR, Role.APROBADOR_CFO, Role.ADMIN_CLIENTE] as const;

export class UpdateRoleDto {
  @IsIn(CLIENTE_ROLES)
  role: Role;
}
