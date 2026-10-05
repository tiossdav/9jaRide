import { Body, Controller, Delete, Global, HttpCode, Module, Post } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { PushApp, PushService } from './push.service';

class TokenDto {
  @IsString() @MinLength(20) @MaxLength(4096) token!: string;
}

/** The apps send their Firebase token here after signing in, so the server can reach the phone when the app is closed. */
@Controller('me/push-token')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Roles('rider', 'driver') @Post() @HttpCode(204)
  async register(@CurrentUser() me: Principal, @Body() dto: TokenDto) {
    await this.push.register(me.id, dto.token, me.role as PushApp);
  }

  @Roles('rider', 'driver') @Delete() @HttpCode(204)
  async unregister(@CurrentUser() me: Principal, @Body() dto: TokenDto) {
    await this.push.unregister(me.id, dto.token);
  }
}

@Global()
@Module({ controllers: [PushController], providers: [PushService], exports: [PushService] })
export class PushModule {}
