import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import type { AuthenticatedUser } from './types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Public + unauthenticated, so it needs a much tighter cap than the global
  // default to keep it from being used for account-creation spam.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Public()
  @Post('registro-proveedor')
  registerProveedor(@Body() dto: RegisterProveedorDto) {
    return this.authService.registerProveedor(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.sub, user.companyId);
  }

  /** Each user edits their own name and job title (email and role are managed elsewhere). */
  @Patch('me')
  actualizarPerfil(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActualizarPerfilDto,
  ) {
    return this.authService.actualizarPerfil(user.sub, dto);
  }

  @Post('aceptar-terminos')
  aceptarTerminos(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.aceptarTerminos(user.sub);
  }
}
