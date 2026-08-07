import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Verify2FADto } from './dto/verify-2fa.dto';
import { SelectCompanyDto } from './dto/select-company.dto';
import { SwitchCompanyDto } from './dto/switch-company.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import type { AuthenticatedUser } from './types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('verify-2fa')
  verify2FA(@Body() dto: Verify2FADto) {
    return this.authService.verify2FA(dto.pendingToken, dto.code);
  }

  @Public()
  @Post('select-company')
  selectCompany(@Body() dto: SelectCompanyDto) {
    return this.authService.selectCompany(dto.pendingToken, dto.companyId);
  }

  @Post('switch-company')
  switchCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchCompanyDto) {
    return this.authService.switchCompany(user.sub, dto.companyId);
  }

  @Public()
  @Post('registro-proveedor')
  registerProveedor(@Body() dto: RegisterProveedorDto) {
    return this.authService.registerProveedor(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.sub, user.companyId);
  }
}
