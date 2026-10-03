import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser, Principal, Public } from './auth.types';

class RequestOtpDto {
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsIn(['sms', 'voice']) channel?: 'sms' | 'voice';
}

class RegistrationDto {
  @IsIn(['rider', 'driver']) role!: 'rider' | 'driver';
  @IsString() @MinLength(2) @MaxLength(100) fullName!: string;
}

class VerifyOtpDto {
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @Length(6, 6) code!: string;
}

class RegisterDto extends RegistrationDto {
  @IsString() @MaxLength(1000) registrationTicket!: string;
}

class RefreshDto {
  @IsString() @MaxLength(200) refreshToken!: string;
}

class StaffLoginDto {
  @IsString() @MaxLength(200) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('auth/otp/request') @HttpCode(200)
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const r = await this.auth.requestOtp(dto.phone, dto.channel ?? 'sms', req.ip ?? null);
    return { sent: true, expiresInSeconds: r.expiresInSeconds };
  }

  @Public() @Post('auth/otp/verify') @HttpCode(200)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const r = await this.auth.verifyOtp(dto.phone, dto.code);
    return { ...r.tokens, role: r.role, isNewUser: r.isNewUser };
  }

  @Public() @Post('auth/register') @HttpCode(200)
  async register(@Body() dto: RegisterDto) {
    const r = await this.auth.register(dto.registrationTicket, { role: dto.role, fullName: dto.fullName });
    return { ...r.tokens, role: r.role, isNewUser: r.isNewUser };
  }

  @Public() @Post('auth/refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public() @Post('auth/logout') @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('auth/logout-all') @HttpCode(204)
  async logoutAll(@CurrentUser() me: Principal) {
    await this.auth.logoutEverywhere(me);
  }

  @Public() @Post('auth/staff/login') @HttpCode(200)
  async staffLogin(@Body() dto: StaffLoginDto) {
    const r = await this.auth.staffLogin(dto.email, dto.password);
    return { ...r.tokens, role: r.role };
  }

  @Get('me')
  me(@CurrentUser() me: Principal) {
    return { id: me.id, kind: me.kind, role: me.role };
  }
}
