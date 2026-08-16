import { IsEmail, IsIn } from 'class-validator';
import { Role } from '@prisma/client';

// This DTO only ever reaches UsuariosService, which hardcodes portal: CLIENTE —
// restricting to cliente-portal roles keeps an ADMIN_CLIENTE from creating a
// portal=CLIENTE / role=PROVEEDOR|CONSULTOR|COMPLIANCE_OPS inconsistency.
const CLIENTE_ROLES = [Role.COMPRADOR, Role.APROBADOR_CFO, Role.ADMIN_CLIENTE] as const;

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsIn(CLIENTE_ROLES)
  role: Role;
}
