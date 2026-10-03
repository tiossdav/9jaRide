import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsObject } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { SettingsService } from './settings.service';
import { SettingKey } from './settings.types';

enum Key { revenue = 'revenue', cancellation = 'cancellation' }

class ProposeDto {
  @IsObject() value!: Record<string, unknown>;
  @Type(() => Date) @IsDate() effectiveFrom!: Date;
}

/** Editable business rules. Support can read them; only admins change them, and a different admin approves. */
@Controller('admin/settings')
@UseInterceptors(StaffAuditInterceptor)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Roles('support', 'finance', 'admin') @Get(':key')
  async get(@Param('key', new ParseEnumPipe(Key)) key: SettingKey) {
    return { current: await this.settings.effective(key), versions: await this.settings.list(key) };
  }

  @Roles('admin') @Post(':key') @HttpCode(200)
  propose(@CurrentUser() me: Principal, @Param('key', new ParseEnumPipe(Key)) key: SettingKey, @Body() dto: ProposeDto) {
    return this.settings.propose(me.id, key, dto.value, dto.effectiveFrom);
  }

  @Roles('admin') @Post('versions/:id/approve') @HttpCode(204)
  async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) { await this.settings.approve(me.id, id); }

  @Roles('admin') @Delete('versions/:id') @HttpCode(204)
  async discard(@Param('id', ParseUUIDPipe) id: string) { await this.settings.discard(id); }
}
