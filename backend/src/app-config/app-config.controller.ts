import { Body, Controller, Get, Headers, HttpCode, Put, UseInterceptors } from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentUser, Principal, Public, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { AppConfigService, Platform } from './app-config.service';

class UpdateDto {
  @IsIn(['android', 'ios']) platform!: Platform;
  @IsString() @Matches(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/) minVersion!: string;
  @IsString() @Matches(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/) latestVersion!: string;
  @IsString() @MaxLength(300) updateUrl!: string;
}

@Controller()
export class AppConfigController {
  constructor(private readonly config: AppConfigService) {}

  /** Called by the apps at start-up, before sign-in: they send X-App-Platform and X-App-Version. */
  @Public() @Get('app/config')
  forClient(@Headers('x-app-platform') platform?: string, @Headers('x-app-version') version?: string) {
    return this.config.forClient(platform === 'android' || platform === 'ios' ? platform : undefined, version);
  }

  @Roles('admin') @Get('admin/app-config')
  current() {
    return this.config.current();
  }

  @Roles('admin') @Put('admin/app-config') @HttpCode(200) @UseInterceptors(StaffAuditInterceptor)
  update(@CurrentUser() me: Principal, @Body() dto: UpdateDto) {
    return this.config.update(me.id, dto.platform, { minVersion: dto.minVersion, latestVersion: dto.latestVersion, updateUrl: dto.updateUrl });
  }
}
